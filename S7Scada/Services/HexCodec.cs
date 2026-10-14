using System.Text;

namespace S7Scada.Services;

/// <summary>十六进制字符串与字节数组互转（原始报文收发用）</summary>
public static class HexCodec
{
    /// <summary>
    /// 把十六进制字符串解析为字节数组。忽略空格 / 逗号 / 0x 前缀等分隔符；
    /// 字符个数为奇数或含非法字符时返回 null（由调用方给出提示）。
    /// </summary>
    public static byte[]? Parse(string? hex)
    {
        if (string.IsNullOrWhiteSpace(hex)) return [];

        var digits = new StringBuilder();
        foreach (char c in hex)
        {
            if (c is ' ' or '\t' or ',' or '-' or '\r' or '\n') continue;
            if (Uri.IsHexDigit(c)) { digits.Append(c); continue; }
            if (c is 'x' or 'X') continue; // 容忍 0x 前缀
            return null;
        }

        if (digits.Length % 2 != 0) return null;

        var bytes = new byte[digits.Length / 2];
        for (int i = 0; i < bytes.Length; i++)
            bytes[i] = Convert.ToByte(digits.ToString(i * 2, 2), 16);
        return bytes;
    }

    /// <summary>字节数组格式化为大写十六进制字符串（空格分隔）</summary>
    public static string Format(byte[] data) => string.Join(" ", data.Select(b => b.ToString("X2")));
}
