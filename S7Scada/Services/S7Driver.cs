using S7.Net;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>
/// S7 协议驱动（基于 S7netplus）。
/// 负责 S7 侧的批量读取（按 (区域, DB) 分组、区间合并分块读）、写入与数据解析。
/// </summary>
public class S7Driver : IPlcDriver
{
    private Plc? _plc;

    public bool IsConnected => _plc?.IsConnected == true;

    public void Open(PlcConnectionSettings settings)
    {
        _plc = new Plc(settings.Cpu, settings.Ip, (short)settings.Rack, (short)settings.Slot)
        {
            ReadTimeout = settings.IoTimeoutMs,
            WriteTimeout = settings.IoTimeoutMs
        };
        _plc.Open();
    }

    public void Close()
    {
        try { _plc?.Close(); } catch { }
        _plc = null;
    }

    public void Dispose() => Close();

    public PlcInfo GetInfo(PlcConnectionSettings settings)
    {
        // S7netplus 0.20 未暴露 ReadSZL，按所选 CPU 型号给出名称
        return new PlcInfo
        {
            Module = settings.Cpu switch
            {
                CpuType.S71200 => "S7-1200",
                CpuType.S71500 => "S7-1500",
                CpuType.S7300 => "S7-300",
                CpuType.S7400 => "S7-400",
                _ => "S7 PLC"
            }
        };
    }

    public List<TagScanResult> Scan(List<(int idx, TagConfig tag)> tags, string timestamp)
    {
        var results = new List<TagScanResult>();
        if (_plc == null) return results;

        var groups = tags
            .Where(t => t.tag.ScanEnabled)
            .GroupBy(t => (t.tag.Area, t.tag.DbNumber));

        foreach (var group in groups)
        {
            try
            {
                ReadGroup(group.Key.Area, group.Key.DbNumber, group.ToList(), results, timestamp);
            }
            catch (Exception ex)
            {
                string errDesc = group.Key.Area == Area.DB
                    ? $"DB{group.Key.DbNumber}"
                    : $"{group.Key.Area.Prefix()} area";
                string fullErr = $"[{errDesc}] {IPlcDriver.FriendlyError(ex)}";
                foreach (var (idx, _) in group)
                    results.Add(new TagScanResult(idx, null, TagQuality.Bad, timestamp, fullErr));
            }
        }

        return results;
    }

    public (bool Success, string Message) Write(TagConfig tag, object value)
    {
        if (_plc == null) return (false, "PLC 未连接");
        try
        {
            if (tag.DataType == TagDataType.Bool)
                return WriteBool(tag, value);

            byte[]? data = TagValueCodec.ValueToBytes(value, tag.DataType);
            if (data == null) return (false, "值转换失败");

            if (tag.Area == Area.DB)
                _plc.WriteBytes(S7.Net.DataType.DataBlock, (ushort)tag.DbNumber, tag.ByteOffset, data);
            else
                _plc.WriteBytes(tag.Area.ToS7NetArea(), (ushort)tag.DbNumber, tag.ByteOffset, data);

            return (true, "写入成功");
        }
        catch (Exception ex)
        {
            return (false, IPlcDriver.FriendlyError(ex));
        }
    }

    // ── 批量读取 ────────────────────────────────────────

    /// <summary>
    /// 读取一个 (区域, DB) 分组内的所有标签。
    /// 不按 min..max 整段读取：把各标签占用的字节区间合并成邻接块再分块读，
    /// 既避免标签相距很远时的海量无用流量，也把块大小限制在 PDU 上限内。
    /// </summary>
    private void ReadGroup(Area area, int dbNum,
        List<(int idx, TagConfig tag)> tagList,
        List<TagScanResult> results, string timestamp)
    {
        var enabled = tagList.Where(t => t.tag.ScanEnabled).ToList();
        if (enabled.Count == 0 || _plc == null) return;

        // 单次 ReadBytes 的最大字节数：S7 报文可用负载受 PDU 限制
        // （1200/1500 通常约 222 字节），取 200 作保守上限，确保不会超限。
        const int maxBlockSize = 200;

        // 按偏移排序后，把相邻/重叠的区间合并为若干块
        var blocks = new List<(int Start, int Size)>();
        int curStart = -1, curEnd = -1;
        foreach (var (_, tag) in enabled.OrderBy(t => t.tag.ByteOffset))
        {
            int start = tag.ByteOffset;
            int end = start + Math.Max(tag.ByteLength, 1);
            if (curStart < 0)
            {
                curStart = start; curEnd = end;
            }
            else if (start <= curEnd && end - curStart <= maxBlockSize)
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

        // 逐块读取：单块失败只影响该块覆盖的标签，其余标签照常出结果。
        // 保留每块的失败原因，避免只显示笼统的"读取失败"而丢失诊断信息。
        var blockData = new List<(int Start, int Size, byte[]? Data, string? Error)>();
        foreach (var (start, size) in blocks)
        {
            byte[]? data = null;
            string? error = null;
            try
            {
                data = ReadArea(area, dbNum, start, size);
                if (data != null && data.Length < size) { error = "返回数据不完整"; data = null; }
            }
            catch (Exception ex)
            {
                error = IPlcDriver.FriendlyError(ex);
                data = null;
            }
            blockData.Add((start, size, data, error));
        }

        foreach (var (idx, tag) in enabled)
        {
            int start = tag.ByteOffset;
            int end = start + Math.Max(tag.ByteLength, 1);

            byte[]? block = null;
            int blockStart = 0;
            string? blockError = null;
            foreach (var (bStart, bSize, bData, bErr) in blockData)
            {
                if (start >= bStart && end <= bStart + bSize)
                {
                    block = bData;
                    blockStart = bStart;
                    blockError = bErr;
                    break;
                }
            }

            if (block == null)
            {
                results.Add(new TagScanResult(idx, null, TagQuality.Bad, timestamp, blockError ?? "读取失败"));
                continue;
            }

            int localOffset = start - blockStart;
            var tagData = block[localOffset..(localOffset + tag.ByteLength)];
            object? value = TagValueCodec.ParseBytes(tagData, tag.DataType, tag.BitOffset);
            var quality = value != null ? TagQuality.Good : TagQuality.Bad;
            string err = value != null ? "" : "数据解析失败";
            results.Add(new TagScanResult(idx, value, quality, timestamp, err));
        }
    }

    private byte[]? ReadArea(Area area, int dbNum, int start, int size)
    {
        if (_plc == null) return null;

        return area switch
        {
            Area.DB => _plc.ReadBytes(S7.Net.DataType.DataBlock, (ushort)dbNum, start, size),
            _ => _plc.ReadBytes(area.ToS7NetArea(), (ushort)dbNum, start, size)
        };
    }

    // ── 写入 ────────────────────────────────────────────

    private (bool, string) WriteBool(TagConfig tag, object value)
    {
        try
        {
            if (_plc == null) return (false, "PLC 未连接");

            // 读-改-写
            byte[] raw = tag.Area == Area.DB
                ? _plc.ReadBytes(S7.Net.DataType.DataBlock, (ushort)tag.DbNumber, tag.ByteOffset, 1)
                : _plc.ReadBytes(tag.Area.ToS7NetArea(), (ushort)tag.DbNumber, tag.ByteOffset, 1);

            if (raw == null || raw.Length == 0)
                return (false, "读取当前字节失败");

            byte currentByte = raw[0];
            bool boolVal = Convert.ToBoolean(value);
            byte newByte = boolVal
                ? (byte)(currentByte | (1 << tag.BitOffset))
                : (byte)(currentByte & ~(1 << tag.BitOffset));

            byte[] writeData = [newByte];
            if (tag.Area == Area.DB)
                _plc.WriteBytes(S7.Net.DataType.DataBlock, (ushort)tag.DbNumber, tag.ByteOffset, writeData);
            else
                _plc.WriteBytes(tag.Area.ToS7NetArea(), (ushort)tag.DbNumber, tag.ByteOffset, writeData);

            return (true, "写入成功");
        }
        catch (Exception ex)
        {
            return (false, IPlcDriver.FriendlyError(ex));
        }
    }
}
