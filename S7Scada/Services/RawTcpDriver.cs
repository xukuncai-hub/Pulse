using System.Net.Sockets;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>
/// 原始 TCP/IP 透传驱动：面向没有标准协议的自定义设备（扫码枪、称重仪、串口服务器等）。
/// 连接后按配置的报文（十六进制）发送请求，再把返回的字节流按标签的"偏移"解析。
/// 标签地址即为响应数据中的字节偏移（如 0、4、8）；数据类型由用户在界面选择。
/// </summary>
public class RawTcpDriver : IPlcDriver
{
    private TcpClient? _tcp;
    private NetworkStream? _stream;
    private byte[] _request = [];
    private PlcConnectionSettings _settings = new();

    public bool IsConnected => _tcp?.Connected == true;

    public void Open(PlcConnectionSettings settings)
    {
        _settings = settings;
        _request = HexCodec.Parse(settings.SendHex)
            ?? throw new FormatException("发送报文不是合法的十六进制字符串");

        _tcp = new TcpClient();
        _tcp.Connect(settings.Ip, settings.Port); // 阻塞；超时由 PlcService 包一层
        _stream = _tcp.GetStream();
        _stream.ReadTimeout = settings.IoTimeoutMs;
        _stream.WriteTimeout = settings.IoTimeoutMs;
    }

    public void Close()
    {
        try { _stream?.Dispose(); } catch { }
        try { _tcp?.Close(); } catch { }
        _stream = null;
        _tcp = null;
    }

    public void Dispose() => Close();

    public PlcInfo GetInfo(PlcConnectionSettings settings) => new()
    {
        Module = $"原始 TCP 透传（{settings.Ip}:{settings.Port}）"
    };

    public List<TagScanResult> Scan(List<(int idx, TagConfig tag)> tags, string timestamp)
    {
        var results = new List<TagScanResult>();
        var stream = _stream;
        if (stream == null) return results;

        // 每次扫描只发一次请求、读一次响应，随后按偏移把响应映射到各标签
        byte[]? response = null;
        string? error = null;
        try
        {
            if (_request.Length > 0)
                stream.Write(_request, 0, _request.Length);
            response = ReadResponse(stream);
        }
        catch (Exception ex)
        {
            error = IPlcDriver.FriendlyError(ex);
        }

        foreach (var (idx, tag) in tags.Where(t => t.tag.ScanEnabled))
        {
            if (response == null || response.Length == 0)
            {
                results.Add(new TagScanResult(idx, null, TagQuality.Bad, timestamp, error ?? "未收到响应数据"));
                continue;
            }

            int offset = tag.ByteOffset;
            int len = Math.Max(tag.ByteLength, 1);
            if (offset < 0 || offset + len > response.Length)
            {
                results.Add(new TagScanResult(idx, null, TagQuality.Bad, timestamp,
                    $"响应长度不足（收到 {response.Length} 字节，需读取偏移 {offset} 起 {len} 字节）"));
                continue;
            }

            var slice = response[offset..(offset + len)];
            object? value = TagValueCodec.ParseBytes(slice, tag.DataType, tag.BitOffset);
            var quality = value != null ? TagQuality.Good : TagQuality.Bad;
            results.Add(new TagScanResult(idx, value, quality, timestamp, value != null ? "" : "数据解析失败"));
        }

        return results;
    }

    public (bool Success, string Message) Write(TagConfig tag, object value)
    {
        var stream = _stream;
        if (stream == null) return (false, "TCP 未连接");

        try
        {
            byte[] data = tag.DataType == TagDataType.Bool
                ? [(byte)(Convert.ToBoolean(value) ? 1 : 0)]
                : TagValueCodec.ValueToBytes(value, tag.DataType) ?? [];
            if (data.Length == 0) return (false, "值转换失败");

            stream.Write(data, 0, data.Length);
            return (true, "已发送");
        }
        catch (Exception ex)
        {
            return (false, IPlcDriver.FriendlyError(ex));
        }
    }

    /// <summary>
    /// 读取一帧响应：首次读取用完整 IO 超时；之后用较短的"帧间隔"等待，
    /// 一旦空闲超时即认为一帧结束（适合无固定长度的透传数据）。
    /// </summary>
    private byte[]? ReadResponse(NetworkStream stream)
    {
        var buffer = new List<byte>();
        var tmp = new byte[1024];
        int idleMs = Math.Clamp(_settings.IoTimeoutMs / 5, 20, 200);
        const int maxBytes = 65536;

        stream.ReadTimeout = _settings.IoTimeoutMs;
        try
        {
            int first = stream.Read(tmp, 0, tmp.Length);
            if (first <= 0) return null;
            buffer.AddRange(tmp.Take(first));
        }
        finally
        {
            stream.ReadTimeout = idleMs;
        }

        while (buffer.Count < maxBytes)
        {
            int n;
            try
            {
                n = stream.Read(tmp, 0, tmp.Length);
            }
            catch (IOException)
            {
                break; // 空闲超时视为帧结束
            }
            catch (TimeoutException)
            {
                break;
            }
            if (n <= 0) break;
            buffer.AddRange(tmp.Take(n));
        }

        stream.ReadTimeout = _settings.IoTimeoutMs;
        return buffer.ToArray();
    }
}
