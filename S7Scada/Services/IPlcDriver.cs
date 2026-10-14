using S7.Net;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>PLC 连接参数（不同协议只用得到其中一部分字段）</summary>
public class PlcConnectionSettings
{
    /// <summary>协议标识："S7" | "ModbusTcp"</summary>
    public string Protocol { get; set; } = "S7";
    public string Ip { get; set; } = "192.168.0.1";

    // ── Modbus 专用 ──
    public int Port { get; set; } = 502;
    public byte UnitId { get; set; } = 1;

    // ── S7 专用 ──
    public int Rack { get; set; }
    public int Slot { get; set; } = 1;
    public CpuType Cpu { get; set; } = CpuType.S71200;

    // ── 通用 ──
    public int ConnectTimeoutMs { get; set; } = 5000;
    public int IoTimeoutMs { get; set; } = 5000;
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
        if (lower.Contains("address out of range") || lower.Contains("illegal data address"))
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
