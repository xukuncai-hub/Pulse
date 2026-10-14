using System.Text.Json.Serialization;

namespace S7Scada.Models;

/// <summary>S7 数据类型</summary>
public enum TagDataType
{
    Bool, Byte, Word, DWord, Int, DInt, Real
}

/// <summary>标签数据质量</summary>
public enum TagQuality
{
    Good, Bad, Unknown
}

/// <summary>内存区域：S7 的 DB/M/I/Q/T/C，Modbus 的 4 个标准寄存器区，以及原始 TCP 透传的响应数据区</summary>
public enum Area
{
    DB, M, I, Q, T, C,
    // ── Modbus 区 ──
    ModbusHoldingRegister,  // 4x 保持寄存器（读写，16 位）
    ModbusInputRegister,    // 3x 输入寄存器（只读，16 位）
    ModbusCoil,             // 0x 线圈（读写，位）
    ModbusDiscreteInput,    // 1x 离散输入（只读，位）
    // ── 原始 TCP 透传区 ──
    RawData                 // 响应字节流（按字节偏移取值）
}

/// <summary>区域信息扩展</summary>
public static class AreaInfo
{
    public static string Prefix(this Area area) => area switch
    {
        Area.DB => "DB",
        Area.M => "M",
        Area.I => "I",
        Area.Q => "Q",
        Area.T => "T",
        Area.C => "C",
        Area.ModbusHoldingRegister => "HR",
        Area.ModbusInputRegister => "IR",
        Area.ModbusCoil => "CO",
        Area.ModbusDiscreteInput => "DI",
        Area.RawData => "RAW",
        _ => "?"
    };

    /// <summary>是否为 Modbus 区域</summary>
    public static bool IsModbus(this Area area) =>
        area is Area.ModbusHoldingRegister or Area.ModbusInputRegister or Area.ModbusCoil or Area.ModbusDiscreteInput;

    /// <summary>Modbus 位区域（线圈 / 离散输入）</summary>
    public static bool IsModbusBit(this Area area) => area is Area.ModbusCoil or Area.ModbusDiscreteInput;

    /// <summary>S7.Net Area 映射</summary>
    public static S7.Net.DataType ToS7NetArea(this Area area) => area switch
    {
        Area.DB => S7.Net.DataType.DataBlock,
        Area.M => S7.Net.DataType.Memory,
        Area.I => S7.Net.DataType.Input,
        Area.Q => S7.Net.DataType.Output,
        Area.T => S7.Net.DataType.Timer,
        Area.C => S7.Net.DataType.Counter,
        _ => S7.Net.DataType.Memory
    };

    public static int ByteSize(this TagDataType dt) => dt switch
    {
        TagDataType.Bool => 1,
        TagDataType.Byte => 1,
        TagDataType.Word => 2,
        TagDataType.Int => 2,
        TagDataType.DWord => 4,
        TagDataType.DInt => 4,
        TagDataType.Real => 4,
        _ => 1
    };

    public static Area FromPrefix(string prefix) => prefix?.ToUpper() switch
    {
        "DB" => Area.DB,
        "M" => Area.M,
        "I" => Area.I,
        "Q" => Area.Q,
        "T" => Area.T,
        "C" => Area.C,
        "HR" => Area.ModbusHoldingRegister,
        "IR" => Area.ModbusInputRegister,
        "CO" => Area.ModbusCoil,
        "DI" => Area.ModbusDiscreteInput,
        "RAW" => Area.RawData,
        _ => Area.M
    };
}

/// <summary>单个标签的完整配置</summary>
public class TagConfig
{
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public Area Area { get; set; } = Area.M;
    public TagDataType DataType { get; set; } = TagDataType.Bool;
    public int DbNumber { get; set; }
    public int ByteOffset { get; set; }
    public int BitOffset { get; set; }
    public string Group { get; set; } = "Default";
    public bool ScanEnabled { get; set; } = true;
    public string Comment { get; set; } = "";

    // 工程量缩放：显示值 = 原始值 × Scale + Offset（Bool 不参与；默认 1/0 表示不缩放）
    public double Scale { get; set; } = 1;
    public double Offset { get; set; }

    // 报警限值（按缩放后的工程量判断；null = 不启用该限）
    public double? AlarmHigh { get; set; }
    public double? AlarmLow { get; set; }

    [JsonIgnore] public bool HasScaling => Scale != 1 || Offset != 0;

    // 运行时数据（不序列化）
    [JsonIgnore] public object? Value { get; set; }
    [JsonIgnore] public TagQuality Quality { get; set; } = TagQuality.Unknown;
    [JsonIgnore] public string Timestamp { get; set; } = "";

    [JsonIgnore] public int ByteLength => DataType.ByteSize();

    [JsonIgnore] public string DisplayName => $"{Name} ({Address})";
}

/// <summary>标签扫描结果</summary>
public record TagScanResult(
    int Index,
    object? Value,
    TagQuality Quality,
    string Timestamp,
    string ErrorMessage = ""
);

/// <summary>标签配置 JSON 序列化模型</summary>
public class TagConfigJson
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("address")] public string Address { get; set; } = "";
    [JsonPropertyName("area")] public string Area { get; set; } = "M";
    [JsonPropertyName("data_type")] public string DataType { get; set; } = "Bool";
    [JsonPropertyName("db_number")] public int DbNumber { get; set; }
    [JsonPropertyName("byte_offset")] public int ByteOffset { get; set; }
    [JsonPropertyName("bit_offset")] public int BitOffset { get; set; }
    [JsonPropertyName("group")] public string Group { get; set; } = "Default";
    [JsonPropertyName("scan_enabled")] public bool ScanEnabled { get; set; } = true;
    [JsonPropertyName("comment")] public string Comment { get; set; } = "";
    [JsonPropertyName("scale")] public double Scale { get; set; } = 1;
    [JsonPropertyName("offset")] public double Offset { get; set; }
    [JsonPropertyName("alarm_high")] public double? AlarmHigh { get; set; }
    [JsonPropertyName("alarm_low")] public double? AlarmLow { get; set; }
}

/// <summary>一条报警事件（内存保存，重启清空）</summary>
public class AlarmEvent
{
    public long Id { get; set; }
    public string TagName { get; set; } = "";
    /// <summary>"High" | "Low"</summary>
    public string Kind { get; set; } = "High";
    public double Value { get; set; }        // 触发时的显示值
    public double Limit { get; set; }        // 触犯的限值
    public string Time { get; set; } = "";   // 触发时间 HH:mm:ss
    public bool Active { get; set; } = true; // 仍越限中
    public bool Acked { get; set; }          // 已确认
}
