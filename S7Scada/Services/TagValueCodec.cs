using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>
/// 数值与字节的互转（S7 与 Modbus 共用）。
/// S7 与 Modbus 寄存器都是大端序（高字在前），因此统一按大端处理。
/// </summary>
public static class TagValueCodec
{
    public static ushort ReadUInt16BE(byte[] d, int offset = 0) => (ushort)((d[offset] << 8) | d[offset + 1]);

    public static uint ReadUInt32BE(byte[] d, int offset = 0) =>
        (uint)((d[offset] << 24) | (d[offset + 1] << 16) | (d[offset + 2] << 8) | d[offset + 3]);

    /// <summary>按数据类型把大端字节解析成数值；无法解析返回 null</summary>
    public static object? ParseBytes(byte[] data, TagDataType dataType, int bitOffset = 0)
    {
        try
        {
            return dataType switch
            {
                TagDataType.Bool when data.Length > 0 => (data[0] & (1 << bitOffset)) != 0,
                TagDataType.Byte when data.Length > 0 => data[0],
                TagDataType.Word when data.Length >= 2 => ReadUInt16BE(data),
                TagDataType.Int when data.Length >= 2 => (short)ReadUInt16BE(data),
                TagDataType.DWord when data.Length >= 4 => ReadUInt32BE(data),
                TagDataType.DInt when data.Length >= 4 => (int)ReadUInt32BE(data),
                TagDataType.Real when data.Length >= 4 => Math.Round(
                    BitConverter.Int32BitsToSingle((int)ReadUInt32BE(data)), 6),
                _ => null
            };
        }
        catch { return null; }
    }

    /// <summary>把数值转成大端字节（S7 写入用）</summary>
    public static byte[]? ValueToBytes(object value, TagDataType dataType)
    {
        try
        {
            return dataType switch
            {
                TagDataType.Byte => [(byte)(Convert.ToByte(value) & 0xFF)],
                TagDataType.Word => [(byte)((Convert.ToUInt16(value) >> 8) & 0xFF), (byte)(Convert.ToUInt16(value) & 0xFF)],
                TagDataType.Int => [(byte)((Convert.ToInt16(value) >> 8) & 0xFF), (byte)(Convert.ToInt16(value) & 0xFF)],
                TagDataType.DWord => U32ToBytes(Convert.ToUInt32(value) & 0xFFFFFFFF),
                TagDataType.DInt => U32ToBytes(unchecked((uint)Convert.ToInt32(value))),
                TagDataType.Real => U32ToBytes(BitConverter.SingleToUInt32Bits(Convert.ToSingle(value))),
                _ => null
            };
        }
        catch { return null; }
    }

    /// <summary>把数值转成 Modbus 寄存器数组（大端，高字在前）</summary>
    public static ushort[] ValueToRegisters(object value, TagDataType dataType)
    {
        switch (dataType)
        {
            case TagDataType.Byte:
                return [(ushort)(Convert.ToByte(value) & 0xFF)];
            case TagDataType.Word:
                return [(ushort)(Convert.ToUInt16(value) & 0xFFFF)];
            case TagDataType.Int:
                return [unchecked((ushort)Convert.ToInt16(value))];
            case TagDataType.DWord:
                { uint v = Convert.ToUInt32(value) & 0xFFFFFFFF; return [(ushort)(v >> 16), (ushort)(v & 0xFFFF)]; }
            case TagDataType.DInt:
                { uint v = unchecked((uint)Convert.ToInt32(value)); return [(ushort)(v >> 16), (ushort)(v & 0xFFFF)]; }
            case TagDataType.Real:
                { uint v = BitConverter.SingleToUInt32Bits(Convert.ToSingle(value)); return [(ushort)(v >> 16), (ushort)(v & 0xFFFF)]; }
            default:
                return [(ushort)(Convert.ToUInt32(value) & 0xFFFF)];
        }
    }

    /// <summary>Modbus 寄存器数组 → 大端字节</summary>
    public static byte[] RegistersToBytes(ushort[] regs)
    {
        var bytes = new byte[regs.Length * 2];
        for (int i = 0; i < regs.Length; i++)
        {
            bytes[i * 2] = (byte)(regs[i] >> 8);
            bytes[i * 2 + 1] = (byte)(regs[i] & 0xFF);
        }
        return bytes;
    }

    private static byte[] U32ToBytes(uint v) =>
        [(byte)((v >> 24) & 0xFF), (byte)((v >> 16) & 0xFF), (byte)((v >> 8) & 0xFF), (byte)(v & 0xFF)];
}
