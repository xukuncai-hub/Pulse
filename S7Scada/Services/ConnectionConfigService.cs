using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace S7Scada.Services;

/// <summary>连接表单的全部参数（用于重启后回填，与协议无关的字段都存）</summary>
public class ConnectionConfig
{
    [JsonPropertyName("protocol")] public string Protocol { get; set; } = "S7";
    [JsonPropertyName("ip")] public string Ip { get; set; } = "192.168.0.1";
    [JsonPropertyName("port")] public int Port { get; set; } = 502;
    [JsonPropertyName("unitId")] public int UnitId { get; set; } = 1;
    [JsonPropertyName("rack")] public int Rack { get; set; }
    [JsonPropertyName("slot")] public int Slot { get; set; } = 1;
    [JsonPropertyName("cpu")] public string Cpu { get; set; } = "S71200";
    [JsonPropertyName("scanInterval")] public int ScanInterval { get; set; } = 100;
    [JsonPropertyName("serialPort")] public string SerialPort { get; set; } = "COM1";
    [JsonPropertyName("baudRate")] public int BaudRate { get; set; } = 9600;
    [JsonPropertyName("dataBits")] public int DataBits { get; set; } = 8;
    [JsonPropertyName("stopBits")] public string StopBits { get; set; } = "One";
    [JsonPropertyName("parity")] public string Parity { get; set; } = "None";
    [JsonPropertyName("sendHex")] public string SendHex { get; set; } = "";
    [JsonPropertyName("rawPort")] public int RawPort { get; set; } = 5000;
}

/// <summary>连接参数持久化：记住用户上次填的表单，重启后自动回填</summary>
public class ConnectionConfigService
{
    private static readonly string ConfigPath =
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "connection.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public ConnectionConfig Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var cfg = JsonSerializer.Deserialize<ConnectionConfig>(File.ReadAllText(ConfigPath));
                if (cfg != null) return cfg;
            }
        }
        catch { }
        return new ConnectionConfig();
    }

    public void Save(ConnectionConfig cfg)
    {
        // 原子写：先写临时文件再覆盖，避免写入中途崩溃留下半截配置
        var tmp = ConfigPath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(cfg, JsonOptions));
        File.Move(tmp, ConfigPath, overwrite: true);
    }
}
