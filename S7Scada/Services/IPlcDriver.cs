using S7.Net;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>PLC 连接参数（不同协议只用得到其中一部分字段）</summary>
public class PlcConnectionSettings
{
    /// <summary>协议标识："S7" | "ModbusTcp" | "ModbusRtu" | "RawTcp"</summary>
    public string Protocol { get; set; } = "S7";
    public string Ip { get; set; } = "192.168.0.1";

    // ── Modbus TCP 专用 ──
    public int Port { get; set; } = 502;
    public byte UnitId { get; set; } = 1;

    // ── 串口专用（Modbus RTU / RS485 / RS232）──
    public string SerialPort { get; set; } = "COM1";
    public int BaudRate { get; set; } = 9600;
    public int DataBits { get; set; } = 8;
    /// <summary>停止位："One" | "Two" | "OnePointFive"</summary>
    public string StopBits { get; set; } = "One";
    /// <summary>校验："None" | "Even" | "Odd"</summary>
    public string Parity { get; set; } = "None";

    // ── 原始 TCP 透传专用 ──
    /// <summary>每次扫描前发送的报文（十六进制字符串，空格可省略；留空表示只接收）</summary>
    public string SendHex { get; set; } = "";

    // ── S7 专用 ──
    public int Rack { get; set; }
    public int Slot { get; set; } = 1;
    public CpuType Cpu { get; set; } = CpuType.S71200;

    // ── 通用 ──
    public int ConnectTimeoutMs { get; set; } = 5000;
    public int IoTimeoutMs { get; set; } = 5000;

    /// <summary>是否为 Modbus 协议（TCP 或 RTU）</summary>
    public bool IsModbus => Protocol.Equals("ModbusTcp", StringComparison.OrdinalIgnoreCase)
                         || Protocol.Equals("ModbusRtu", StringComparison.OrdinalIgnoreCase);

    /// <summary>是否走串口传输（Modbus RTU）</summary>
    public bool IsSerial => Protocol.Equals("ModbusRtu", StringComparison.OrdinalIgnoreCase);

    /// <summary>是否为原始 TCP 透传</summary>
    public bool IsRawTcp => Protocol.Equals("RawTcp", StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// PLC 驱动接口。不同厂商/协议各自实现，上层（PlcService）只做连接生命周期与编排。
/// </summary>
public interface IPlcDriver : IDisposable
{
    bool IsConnected { get; }

    /// <summary>建立连接（同步阻塞；超时由调用方包一层）</summary>
    void Open(PlcConnectionSettings settings);

    /// <summary>关闭连接</summary>
    void Close();

    /// <summary>读取设备信息</summary>
    PlcInfo GetInfo(PlcConnectionSettings settings);

    /// <summary>
    /// 批量扫描。输入为 (标签在列表中的索引, 标签) 的列表，
    /// 返回的 TagScanResult 通过 Index 与输入对应（未启用扫描的标签不返回结果）。
    /// 单个分组失败只影响该分组，不抛给上层。
    /// </summary>
    List<TagScanResult> Scan(List<(int idx, TagConfig tag)> tags, string timestamp);

    /// <summary>写入单个标签</summary>
    (bool Success, string Message) Write(TagConfig tag, object value);

    /// <summary>
    /// 把底层异常转成可读中文提示；无法归类时原样返回，英文原文保留在括号里便于排查。
    /// </summary>
    static string FriendlyError(Exception ex)
    {
        string raw = ex.Message ?? "";
        string lower = raw.ToLowerInvariant();

        string? hint;
        if (lower.Contains("denied"))
            hint = "串口被占用：该端口已被其他程序打开，请关闭后重试";
        else if (lower.Contains("does not exist") || lower.Contains("找不到") || lower.Contains("系统找不到"))
            hint = "串口不存在：请确认端口号（COMx）是否正确、设备是否已插入";
        else if (lower.Contains("address out of range") || lower.Contains("illegal data address"))
            hint = "地址越界：该地址超出设备存储区（数据库/寄存器不存在，或权限未开启）";
        else if (lower.Contains("pdu") || lower.Contains("too large") || lower.Contains("too long"))
            hint = "单次读取数据量超出报文上限";
        else if (lower.Contains("tpkt") || lower.Contains("incomplete"))
            hint = "连接被中断：目标端口没有有效的协议服务响应";
        else if (lower.Contains("refused"))
            hint = "连接被拒绝：目标未监听端口或防火墙拦截";
        else if (lower.Contains("timed out") || lower.Contains("timeout") || lower.Contains("unreachable"))
            hint = "连接超时：目标无响应（检查 IP 是否可达、设备是否运行）";
        else
            hint = null;

        return hint == null ? raw : $"{hint}（{raw}）";
    }
}
