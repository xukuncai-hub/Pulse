using System.IO;
using System.Text;
using System.Text.Json;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>标签配置持久化服务</summary>
public class TagConfigService
{
    private static readonly string DefaultConfigPath =
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "s7_tags.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    /// <summary>加载标签配置</summary>
    public List<TagConfig> Load(string? path = null)
    {
        path ??= DefaultConfigPath;
        if (!File.Exists(path))
            return CreatePresetTags();

        try
        {
            var json = File.ReadAllText(path);
            var items = JsonSerializer.Deserialize<List<TagConfigJson>>(json);
            if (items == null) return CreatePresetTags();

            return items.Select(ConvertFromJson).ToList();
        }
        catch
        {
            return CreatePresetTags();
        }
    }

    /// <summary>保存标签配置</summary>
    public void Save(List<TagConfig> tags, string? path = null)
    {
        path ??= DefaultConfigPath;
        var items = tags.Select(ConvertToJson).ToList();
        var json = JsonSerializer.Serialize(items, JsonOptions);
        WriteAllTextAtomic(path, json);
    }

    /// <summary>原子写：先写临时文件再覆盖，避免写入中途崩溃/断电留下半截损坏的配置</summary>
    private static void WriteAllTextAtomic(string path, string content)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, content);
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>创建预置示例标签</summary>
    public static List<TagConfig> CreatePresetTags()
    {
        var presets = new (string Name, string Addr, TagDataType Type, string Group)[]
        {
            ("急停信号",   "DB1.DBX0.0", TagDataType.Bool, "Alarms"),
            ("运行状态",   "M0.0",       TagDataType.Bool, "Digital Inputs"),
            ("温度值",     "DB1.DBW2",   TagDataType.Int,  "Analog Inputs"),
            ("压力值",     "DB1.DBD4",   TagDataType.Real, "Analog Inputs"),
            ("传感器输入", "I0.0",       TagDataType.Bool, "Digital Inputs"),
            ("产量计数",   "DB1.DBD8",   TagDataType.DInt, "Production Data"),
            ("电机速度",   "DB1.DBW12",  TagDataType.Word, "Parameters"),
            ("输出状态",   "Q0.0",       TagDataType.Bool, "Digital Outputs"),
        };

        return presets.Select(p =>
        {
            var tag = new TagConfig
            {
                Name = p.Name,
                Address = p.Addr,
                DataType = p.Type,
                Group = p.Group,
                ScanEnabled = true
            };
            AddressParser.ParseToTag(p.Addr, tag);
            return tag;
        }).ToList();
    }

    private static TagConfig ConvertFromJson(TagConfigJson json)
    {
        var tag = new TagConfig
        {
            Name = json.Name,
            Address = json.Address,
            DbNumber = json.DbNumber,
            ByteOffset = json.ByteOffset,
            BitOffset = json.BitOffset,
            Group = json.Group,
            ScanEnabled = json.ScanEnabled,
            Comment = json.Comment,
            Scale = json.Scale,
            Offset = json.Offset,
            AlarmHigh = json.AlarmHigh,
            AlarmLow = json.AlarmLow
        };
        tag.Area = AreaInfo.FromPrefix(json.Area);
        tag.DataType = Enum.TryParse<TagDataType>(json.DataType, true, out var dt) ? dt : TagDataType.Bool;
        return tag;
    }

    private static TagConfigJson ConvertToJson(TagConfig tag) => new()
    {
        Name = tag.Name,
        Address = tag.Address,
        Area = tag.Area.Prefix(),
        DataType = tag.DataType.ToString(),
        DbNumber = tag.DbNumber,
        ByteOffset = tag.ByteOffset,
        BitOffset = tag.BitOffset,
        Group = tag.Group,
        ScanEnabled = tag.ScanEnabled,
        Comment = tag.Comment,
        Scale = tag.Scale,
        Offset = tag.Offset,
        AlarmHigh = tag.AlarmHigh,
        AlarmLow = tag.AlarmLow
    };

    // ── CSV 导入 / 导出 ─────────────────────────────────────
    // 列与 TagConfigJson 字段一一对应；带 BOM 头，Excel 直接打开不乱码

    private static readonly string[] CsvHeader =
    [
        "name", "address", "area", "data_type", "db_number", "byte_offset",
        "bit_offset", "group", "scan_enabled", "comment", "scale", "offset"
    ];

    /// <summary>导出标签为 CSV（UTF-8 带 BOM）</summary>
    public static void ExportCsv(List<TagConfig> tags, string path)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(',', CsvHeader));
        foreach (var t in tags)
        {
            sb.AppendLine(string.Join(',', new[]
            {
                CsvEscape(t.Name), CsvEscape(t.Address), CsvEscape(t.Area.Prefix()),
                CsvEscape(t.DataType.ToString()),
                t.DbNumber.ToString(), t.ByteOffset.ToString(), t.BitOffset.ToString(),
                CsvEscape(t.Group), t.ScanEnabled ? "true" : "false",
                CsvEscape(t.Comment),
                t.Scale.ToString(System.Globalization.CultureInfo.InvariantCulture),
                t.Offset.ToString(System.Globalization.CultureInfo.InvariantCulture)
            }));
        }
        // 原子写 + BOM（Excel 识别 UTF-8 中文必需）
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>从 CSV 导入标签（跳过表头；格式错误的行忽略并计数）</summary>
    public static (List<TagConfig> Tags, int Skipped) ImportCsv(string path)
    {
        var tags = new List<TagConfig>();
        int skipped = 0;
        var lines = File.ReadAllLines(path);
        for (int i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cols = ParseCsvLine(line);
            if (cols.Count < 2) { skipped++; continue; }
            // 跳过表头
            if (i == 0 && cols[0].Trim().Equals("name", StringComparison.OrdinalIgnoreCase)) continue;

            string Get(int idx) => idx < cols.Count ? cols[idx].Trim() : "";
            var tag = new TagConfig
            {
                Name = Get(0),
                Address = Get(1).ToUpperInvariant(),
                Area = AreaInfo.FromPrefix(Get(2)),
                DataType = Enum.TryParse<TagDataType>(Get(3), true, out var dt) ? dt : TagDataType.Bool,
                DbNumber = int.TryParse(Get(4), out var db) ? db : 0,
                ByteOffset = int.TryParse(Get(5), out var bo) ? bo : 0,
                BitOffset = int.TryParse(Get(6), out var bi) ? bi : 0,
                Group = string.IsNullOrEmpty(Get(7)) ? "Default" : Get(7),
                ScanEnabled = !Get(8).Equals("false", StringComparison.OrdinalIgnoreCase),
                Comment = Get(9),
                Scale = double.TryParse(Get(10), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var sc) && sc != 0 ? sc : 1,
                Offset = double.TryParse(Get(11), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var of) ? of : 0
            };
            if (string.IsNullOrWhiteSpace(tag.Name) || string.IsNullOrWhiteSpace(tag.Address))
            {
                skipped++;
                continue;
            }
            tags.Add(tag);
        }
        return (tags, skipped);
    }

    /// <summary>CSV 字段转义：含逗号 / 引号 / 换行时用双引号包裹，引号双写</summary>
    private static string CsvEscape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        return value;
    }

    /// <summary>解析一行 CSV（支持双引号包裹字段、引号双写转义）</summary>
    private static List<string> ParseCsvLine(string line)
    {
        var cols = new List<string>();
        var cur = new StringBuilder();
        bool inQuotes = false;
        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
                    else inQuotes = false;
                }
                else cur.Append(c);
            }
            else if (c == '"') inQuotes = true;
            else if (c == ',') { cols.Add(cur.ToString()); cur.Clear(); }
            else cur.Append(c);
        }
        cols.Add(cur.ToString());
        return cols;
    }
}
