using System.IO.Ports;
using System.Net.Sockets;
using NModbus;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>
/// Modbus 驱动（基于 NModbus），TCP 与 RTU 共用同一套寄存器读写逻辑，仅底层传输不同：
///   - Modbus TCP：TCP 连接，报文走 MBAP 头；
///   - Modbus RTU：串口（RS485 / RS232），报文带 CRC16 与帧间隔（由 NModbus 处理）。
/// 支持 4 个标准寄存器区：线圈(CO) / 离散输入(DI) / 输入寄存器(IR) / 保持寄存器(HR)。
/// 寄存器按大端（高字在前）解析，即 AB CD 字序。
/// </summary>
public class ModbusDriver : IPlcDriver
{
    // Modbus 规范单次请求上限：125 个寄存器 / 2000 个位，这里留出余量
    private const int MaxRegistersPerRequest = 120;
    private const int MaxBitsPerRequest = 1900;

    private TcpClient? _tcp;       // TCP 传输
    private SerialPort? _serial;   // 串口传输（RTU）
    private IModbusMaster? _master;
    private PlcConnectionSettings _settings = new();

    public bool IsConnected => _settings.IsSerial
        ? _serial?.IsOpen == true
        : _tcp?.Connected == true;

    public void Open(PlcConnectionSettings settings)
    {
        _settings = settings;
        var factory = new ModbusFactory();

        if (settings.IsSerial)
        {
            _serial = new SerialPort(settings.SerialPort, settings.BaudRate,
                ParseParity(settings.Parity), settings.DataBits, ParseStopBits(settings.StopBits))
            {
                ReadTimeout = settings.IoTimeoutMs,
                WriteTimeout = settings.IoTimeoutMs
            };
            _serial.Open();
            _master = factory.CreateRtuMaster(new SerialStreamAdapter(_serial));
        }
        else
        {
            _tcp = new TcpClient();
            _tcp.Connect(settings.Ip, settings.Port); // 阻塞；超时由 PlcService 包一层
            _master = factory.CreateMaster(_tcp);
        }

        _master.Transport.ReadTimeout = settings.IoTimeoutMs;
        _master.Transport.WriteTimeout = settings.IoTimeoutMs;
    }

    public void Close()
    {
        try { _master?.Dispose(); } catch { }
        try { _tcp?.Close(); } catch { }
        try { _serial?.Close(); } catch { }
        _master = null;
        _tcp = null;
        _serial = null;
    }

    public void Dispose() => Close();

    public PlcInfo GetInfo(PlcConnectionSettings settings) => new()
    {
        Module = settings.IsSerial
            ? $"Modbus RTU（{settings.SerialPort} @ {settings.BaudRate}，从站 {settings.UnitId}）"
            : $"Modbus TCP（从站 {settings.UnitId}）"
    };

    private static Parity ParseParity(string? value) => value?.ToUpperInvariant() switch
    {
        "EVEN" => Parity.Even,
        "ODD" => Parity.Odd,
        _ => Parity.None
    };

    private static StopBits ParseStopBits(string? value) => value?.ToUpperInvariant() switch
    {
        "TWO" => StopBits.Two,
        "ONEPOINTFIVE" or "ONEANDAHALF" or "15" => StopBits.OnePointFive,
        _ => StopBits.One
    };

    public List<TagScanResult> Scan(List<(int idx, TagConfig tag)> tags, string timestamp)
    {
        var results = new List<TagScanResult>();
        var master = _master;
        if (master == null) return results;

        var groups = tags.Where(t => t.tag.ScanEnabled).GroupBy(t => t.tag.Area);
        foreach (var group in groups)
        {
            try
            {
                ReadGroup(master, group.Key, group.ToList(), results, timestamp);
            }
            catch (Exception ex)
            {
                string fullErr = $"[{group.Key.Prefix()}] {IPlcDriver.FriendlyError(ex)}";
                foreach (var (idx, _) in group)
                    results.Add(new TagScanResult(idx, null, TagQuality.Bad, timestamp, fullErr));
            }
        }
        return results;
    }

    public (bool Success, string Message) Write(TagConfig tag, object value)
    {
        var master = _master;
        if (master == null) return (false, "PLC 未连接");

        try
        {
            byte unit = _settings.UnitId;
            ushort addr = (ushort)tag.ByteOffset;

            if (tag.Area.IsModbusBit())
            {
                if (tag.Area == Area.ModbusDiscreteInput)
                    return (false, "离散输入区只读，无法写入");
                master.WriteSingleCoil(unit, addr, Convert.ToBoolean(value));
                return (true, "写入成功");
            }

            if (tag.Area == Area.ModbusInputRegister)
                return (false, "输入寄存器只读，无法写入");

            if (tag.DataType == TagDataType.Bool)
            {
                // 保持寄存器内的位：读-改-写（操作寄存器最低位）
                ushort cur = master.ReadHoldingRegisters(unit, addr, 1)[0];
                ushort next = Convert.ToBoolean(value) ? (ushort)(cur | 0x0001) : (ushort)(cur & 0xFFFE);
                master.WriteSingleRegister(unit, addr, next);
                return (true, "写入成功");
            }

            ushort[] regs = TagValueCodec.ValueToRegisters(value, tag.DataType);
            if (regs.Length == 1)
                master.WriteSingleRegister(unit, addr, regs[0]);
            else
                master.WriteMultipleRegisters(unit, addr, regs);

            return (true, "写入成功");
        }
        catch (Exception ex)
        {
            return (false, IPlcDriver.FriendlyError(ex));
        }
    }

    // ── 批量读取 ────────────────────────────────────────

    /// <summary>一个标签占用的单元数（位区=1 个位；寄存器区按类型 1~2 个寄存器）</summary>
    private static int UnitCount(TagConfig tag)
    {
        if (tag.Area.IsModbusBit()) return 1;
        return tag.DataType switch
        {
            TagDataType.DWord or TagDataType.DInt or TagDataType.Real => 2,
            _ => 1
        };
    }

    /// <summary>按区域分组读取：相邻区间合并成块，分块请求（受 Modbus 单次上限约束）</summary>
    private void ReadGroup(IModbusMaster master, Area area,
        List<(int idx, TagConfig tag)> list,
        List<TagScanResult> results, string timestamp)
    {
        bool bitArea = area.IsModbusBit();
        int maxPer = bitArea ? MaxBitsPerRequest : MaxRegistersPerRequest;

        var blocks = new List<(int Start, int Count)>();
        int curStart = -1, curEnd = -1;
        foreach (var (_, tag) in list.OrderBy(t => t.tag.ByteOffset))
        {
            int start = tag.ByteOffset;
            int end = start + UnitCount(tag);
            if (curStart < 0)
            {
                curStart = start; curEnd = end;
            }
            else if (start <= curEnd && end - curStart <= maxPer)
            {
                if (end > curEnd) curEnd = end;
            }
            else
            {
                blocks.Add((curStart, curEnd - curStart));
                curStart = start; curEnd = end;
            }
        }
        if (curStart >= 0) blocks.Add((curStart, curEnd - curStart));

        // 逐块读取：单块失败只影响该块覆盖的标签，并保留失败原因
        var blockData = new List<(int Start, int Count, ushort[]? Regs, bool[]? Bits, string? Error)>();
        foreach (var (start, count) in blocks)
        {
            ushort[]? regs = null;
            bool[]? bits = null;
            string? error = null;
            try
            {
                if (bitArea)
                    bits = area == Area.ModbusCoil
                        ? master.ReadCoils(_settings.UnitId, (ushort)start, (ushort)count)
                        : master.ReadInputs(_settings.UnitId, (ushort)start, (ushort)count);
                else
                    regs = area == Area.ModbusHoldingRegister
                        ? master.ReadHoldingRegisters(_settings.UnitId, (ushort)start, (ushort)count)
                        : master.ReadInputRegisters(_settings.UnitId, (ushort)start, (ushort)count);
            }
            catch (Exception ex)
            {
                error = IPlcDriver.FriendlyError(ex);
            }
            blockData.Add((start, count, regs, bits, error));
        }

        foreach (var (idx, tag) in list)
        {
            int start = tag.ByteOffset;
            int need = UnitCount(tag);

            int bIdx = -1;
            for (int i = 0; i < blockData.Count; i++)
            {
                if (start >= blockData[i].Start && start + need <= blockData[i].Start + blockData[i].Count)
                {
                    bIdx = i;
                    break;
                }
            }

            if (bIdx < 0)
            {
                results.Add(new TagScanResult(idx, null, TagQuality.Bad, timestamp, "读取失败"));
                continue;
            }

            var block = blockData[bIdx];
            if (block.Error != null)
            {
                results.Add(new TagScanResult(idx, null, TagQuality.Bad, timestamp, block.Error));
                continue;
            }

            int local = start - block.Start;
            object? value;
            if (bitArea)
            {
                value = block.Bits![local];
            }
            else if (tag.DataType == TagDataType.Bool)
            {
                // 寄存器内的位：取寄存器最低位
                value = (block.Regs![local] & 0x0001) != 0;
            }
            else
            {
                var slice = new ushort[need];
                Array.Copy(block.Regs!, local, slice, 0, need);
                value = TagValueCodec.ParseBytes(TagValueCodec.RegistersToBytes(slice), tag.DataType, tag.BitOffset);
            }

            var quality = value != null ? TagQuality.Good : TagQuality.Bad;
            string err = value != null ? "" : "数据解析失败";
            results.Add(new TagScanResult(idx, value, quality, timestamp, err));
        }
    }
}
