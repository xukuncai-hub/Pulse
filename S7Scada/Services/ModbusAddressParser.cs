using System.Text.RegularExpressions;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>
/// Modbus 地址解析器。支持两种写法：
///   1) 区域前缀 + 0 基址地址：HR100 / IR0 / CO5 / DI3
///   2) Modicon 传统 1 基址编号（至少 5 位）：40001 / 30001 / 10001 / 00001
///      （编号的第 1 位表示区域，其余为 1 基址，寄存器偏移 = 编号 - 1）
/// 位区域（线圈 / 离散输入）默认 Bool；寄存器区默认 Word，用户可在界面改成 Int / DWord / DInt / Real。
/// </summary>
public static partial class ModbusAddressParser
{
    // 区域前缀 + 地址：HR100, IR0, CO5, DI3
    [GeneratedRegex(@"^(HR|IR|CO|DI)(\d+)$", RegexOptions.IgnoreCase)]
    private static partial Regex PrefixRegex();

    // Modicon 编号：40001 / 30001 / 10001 / 00001（首位区域，其余为 1 基址）
    [GeneratedRegex(@"^([0134])(\d{4,5})$")]
    private static partial Regex ModiconRegex();

    /// <summary>解析 Modbus 地址字符串</summary>
    public static ParsedAddress? Parse(string? address)
    {
        if (string.IsNullOrWhiteSpace(address)) return null;
        address = address.Trim().ToUpperInvariant();

        var m = PrefixRegex().Match(address);
        if (m.Success)
            return Build(TokenToArea(m.Groups[1].Value), int.Parse(m.Groups[2].Value), address);

        var n = ModiconRegex().Match(address);
        if (n.Success)
        {
            int oneBased = int.Parse(n.Groups[2].Value);
            if (oneBased <= 0) return null;
            var area = n.Groups[1].Value[0] switch
            {
                '0' => Area.ModbusCoil,
                '1' => Area.ModbusDiscreteInput,
                '3' => Area.ModbusInputRegister,
                _ => Area.ModbusHoldingRegister
            };
            return Build(area, oneBased - 1, address);
        }

        return null;
    }

    /// <summary>解析地址并填充 TagConfig 字段</summary>
    public static bool ParseToTag(string address, TagConfig tag)
    {
        var parsed = Parse(address);
        if (parsed == null) return false;

        tag.Area = parsed.Area;
        tag.DataType = parsed.DataType;
        tag.DbNumber = 0;
        tag.ByteOffset = parsed.ByteOffset;
        tag.BitOffset = parsed.BitOffset;
        return true;
    }

    private static Area TokenToArea(string token) => token switch
    {
        "HR" => Area.ModbusHoldingRegister,
        "IR" => Area.ModbusInputRegister,
        "CO" => Area.ModbusCoil,
        _ => Area.ModbusDiscreteInput
    };

    private static ParsedAddress? Build(Area area, int offset, string raw)
    {
        if (offset < 0 || offset > 0xFFFF) return null;
        var type = area.IsModbusBit() ? TagDataType.Bool : TagDataType.Word;
        return new ParsedAddress(area, type, 0, offset, 0, raw);
    }
}
