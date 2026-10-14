using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using S7Scada.Models;
using S7Scada.Services;
using Windows.Foundation;
using Windows.Graphics;
using WinRT.Interop;

namespace S7Scada.Views;

public partial class MainWindow : Window
{
    private readonly PlcService _plc;
    private readonly TagConfigService _configService;
    private readonly ScreenConfigService _screenConfig = new();
    private readonly ConnectionConfigService _connConfigService = new();
    private readonly List<TagConfig> _tags = [];
    private string _protocol = "S7"; // 当前选择的协议：S7 | ModbusTcp | ModbusRtu | RawTcp

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    // 原生标题栏随主题配色（深色模式 / 标题栏背景与文字颜色）
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int attrValue, int attributeSize);
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_CAPTION_COLOR = 35;
    private const int DWMWA_TEXT_COLOR = 36;
    private const int DWMWA_BORDER_COLOR = 34;

    public MainWindow(PlcService plc, TagConfigService configService)
    {
        _plc = plc;
        _configService = configService;
        InitializeComponent();
        MakeBorderless();
        ApplyAppIcon();
        SizeAndCenterWindow();

        // 窗口尺寸/状态变化时（最大化、还原、拖边缩放）重新告知前端按钮区宽度
        AppWindow.Changed += (_, args) =>
        {
            if (args.DidPresenterChange || args.DidSizeChange)
                DispatcherQueue.TryEnqueue(PushWindowMetrics);
        };
    }

    /// <summary>把"系统窗口按钮实际占用的宽度"告诉前端，避免工具栏内容压到按钮下面。
    /// 这个宽度由平台给出（DPI、窗口状态、语言方向都会影响），不能用固定值。</summary>
    private void PushWindowMetrics()
    {
        try
        {
            // RightInset 单位为逻辑像素，与前端 CSS px 同一坐标系，可直接用
            SendToJs(new { type = "windowMetrics", rightInset = AppWindow.TitleBar.RightInset });
        }
        catch { }
    }

    /// <summary>设置窗口/任务栏图标（WinUI 的 Window 没有 Icon 属性，用 AppWindow.SetIcon）</summary>
    private void ApplyAppIcon()
    {
        try
        {
            var ico = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "AppIcon.ico");
            if (File.Exists(ico))
                AppWindow.SetIcon(ico);
        }
        catch
        {
            // 图标缺失不影响功能
        }
    }

    /// <summary>把内容扩展到标题栏区域，并释放系统自带的窗口按钮
    /// （最小化/最大化/关闭直接用系统原生按钮：原生 hover、最大↔还原图标自动切换、Snap 布局都在）。
    /// 窗口拖动仍由前端的 app-region: drag 负责（见 WebView2 非客户区支持）。</summary>
    private void MakeBorderless()
    {
        try
        {
            var appWindow = AppWindow;
            appWindow.TitleBar.ExtendsContentIntoTitleBar = true;

            // 系统按钮背景透明，让它直接落在工具栏底色上（避免出现按钮方块）
            appWindow.TitleBar.ButtonBackgroundColor = Microsoft.UI.Colors.Transparent;
            appWindow.TitleBar.ButtonInactiveBackgroundColor = Microsoft.UI.Colors.Transparent;

            // 只保留前端自绘的拖拽区，系统标题栏本身不提供拖拽矩形
            appWindow.TitleBar.SetDragRectangles([]);
        }
        catch { }
    }

    /// <summary>App 在 Activate() 之后调用（此时 hwnd 才有效）。默认浅色，theme 消息会再设置。</summary>
    public void ApplyInitialTitlebarTheme() => SetTitlebarTheme(false);

    private void SetTitlebarTheme(bool dark)
    {
        var hwnd = WindowNative.GetWindowHandle(this);

        // 沉浸式深色标题栏（Win10 1809+）
        if (Environment.OSVersion.Version.Build >= 17763)
        {
            int darkMode = dark ? 1 : 0;
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));
        }

        // Win11 专属：标题栏背景色 / 文字颜色与主题对齐（值格式为 0x00BBGGRR）
        if (Environment.OSVersion.Version.Build >= 22000)
        {
            int caption = dark ? 0x17110D : 0xFBF9F8; // #0d1117 / #f8f9fb
            int text = dark ? 0xF3EDE6 : 0x6A6057;    // #e6edf3 / #57606a
            // 自绘标题栏窗口的四周仍由 DWM 画窗框，不设置时是纯黑色（浅色主题下非常明显）
            int border = dark ? 0x1A1512 : 0xFFFFFF;  // #12151a / #ffffff，与工具栏、状态栏同色
            DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
            DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, ref text, sizeof(int));
            DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, sizeof(int));
        }
    }

    private void SizeAndCenterWindow()
    {
        try
        {
            var appWindow = AppWindow;
            appWindow.Resize(new SizeInt32(1200, 800));

            var area = DisplayArea.GetFromWindowId(appWindow.Id, DisplayAreaFallback.Primary);
            var wa = area.WorkArea;
            appWindow.Move(new PointInt32(
                wa.X + (wa.Width - appWindow.Size.Width) / 2,
                wa.Y + (wa.Height - appWindow.Size.Height) / 2));
        }
        catch
        {
            // AppWindow 尚未就绪时忽略，窗口保持默认大小
        }
    }

    // ── Initialization ──────────────────────────────────────
    // Called from App.OnLaunched after Show(). Full sequence:
    // load tags -> init WebView2 -> wait for page navigation (so the
    // JS message listener is registered) -> push the tag list.

    public async Task InitializeAsync()
    {
        // Load saved tags
        var tags = _configService.Load();
        _tags.Clear();
        _tags.AddRange(tags);
        _plc.SetTags([.. _tags]);

        await InitializeWebView();

        // Now the frontend is listening; push the initial tag list and screens.
        PushWindowMetrics();
        SendAppInfo();
        PushInitConfig();
        await PushTagsToJs();
        PushScreensToJs();
    }

    /// <summary>把上次保存的连接参数 + 本机可用串口列表推给前端回填表单</summary>
    private void PushInitConfig()
    {
        try
        {
            var cfg = _connConfigService.Load();
            SendToJs(new { type = "initConfig", connection = cfg, serialPorts = GetAvailableSerialPorts() });
        }
        catch { }
    }

    private static string[] GetAvailableSerialPorts()
    {
        try
        {
            return System.IO.Ports.SerialPort.GetPortNames()
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(port => port.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
                    && int.TryParse(port.AsSpan(3), out int number) ? number : int.MaxValue)
                .ThenBy(port => port, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private void PushSerialPortsToJs()
    {
        SendToJs(new { type = "serialPortsChanged", serialPorts = GetAvailableSerialPorts() });
    }

    /// <summary>把应用名与版本推给前端：让"关于"里的版本跟程序集版本保持一致，不再两处硬编码</summary>
    private void SendAppInfo()
    {
        try
        {
            var v = typeof(MainWindow).Assembly.GetName().Version;
            SendToJs(new { type = "appInfo", name = "Pulse", version = v == null ? "" : $"{v.Major}.{v.Minor}" });
        }
        catch { }
    }

    /// <summary>把保存的画面配置推给前端</summary>
    private void PushScreensToJs()
    {
        try
        {
            var raw = _screenConfig.Load();
            var screens = JsonDocument.Parse(raw).RootElement;
            SendToJs(new { type = "screensChanged", screens });
        }
        catch
        {
            SendToJs(new { type = "screensChanged", screens = Array.Empty<object>() });
        }
    }

    private async Task InitializeWebView()
    {
        // WinRT 投影没有 CreateAsync(userDataFolder) 重载；自定义用户数据目录用 CreateWithOptionsAsync
        var env = await CoreWebView2Environment.CreateWithOptionsAsync(
            null,
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebView2Data"),
            null);

        await WebView.EnsureCoreWebView2Async(env);

        // 启用非客户区支持：前端工具栏的 -webkit-app-region: drag 才会生效（窗口拖动）
        try { WebView.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = true; } catch { }

        // 前端 <a target="_blank"> 交给系统默认浏览器打开（否则在 WebView 内无反应）
        WebView.CoreWebView2.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
        };

        // Handle messages from JS
        WebView.WebMessageReceived += OnWebMessageReceived;

        // Subscribe to PLC events
        _plc.Connected += () => DispatcherQueue.TryEnqueue(OnPlcConnected);
        _plc.Disconnected += msg => DispatcherQueue.TryEnqueue(() => OnPlcDisconnected(msg));
        _plc.ConnectionError += err => DispatcherQueue.TryEnqueue(() => OnPlcError(err));
        _plc.ScanFaulted += err => DispatcherQueue.TryEnqueue(() => OnPlcScanFaulted(err));
        _plc.PlcInfoReceived += info => DispatcherQueue.TryEnqueue(() => OnPlcInfo(info));
        _plc.DataUpdated += results => DispatcherQueue.TryEnqueue(() => OnDataUpdated(results));
        _plc.ScanTime += ms => DispatcherQueue.TryEnqueue(() => OnScanTime(ms));

        // Navigate to the local HTML file and wait for it to finish loading
        // so that app.js (which registers the 'message' listener) is ready.
        var htmlPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wwwroot", "index.html");
        var navigationDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        TypedEventHandler<CoreWebView2, CoreWebView2NavigationCompletedEventArgs> onNav = (_, __) =>
            navigationDone.TrySetResult(true);
        WebView.CoreWebView2.NavigationCompleted += onNav;
        WebView.CoreWebView2.Navigate(new Uri(htmlPath).AbsoluteUri);
        await navigationDone.Task;
        WebView.CoreWebView2.NavigationCompleted -= onNav;
    }

    // ── PLC Event Handlers ──────────────────────────────────

    private void OnPlcConnected()
    {
        SendToJs(new { type = "connectionChanged", connected = true, text = "已连接", connecting = false });
    }

    private void OnPlcDisconnected(string msg)
    {
        SendToJs(new { type = "connectionChanged", connected = false, text = "未连接", connecting = false });
    }

    private void OnPlcError(string error)
    {
        // 单次尝试失败：提示一次，状态回到未连接，由用户手动重新点击"连接"
        SendToJs(new { type = "connectionChanged", connected = false, text = $"连接失败：{error}", connecting = false });
        SendToJs(new { type = "error", text = $"连接失败：{error}" });
    }

    private void OnPlcScanFaulted(string error)
    {
        SendToJs(new { type = "connectionChanged", connected = false, text = $"扫描中断：{error}", connecting = false });
        SendToJs(new { type = "error", text = $"PLC 扫描中断：{error}" });
    }

    private void OnPlcInfo(PlcInfo info)
    {
        SendToJs(new { type = "plcInfo", info });
    }

    private void OnDataUpdated(List<TagScanResult> results)
    {
        // 把扫描结果写回本地标签列表，这样后续 tagsChanged 重渲染
        // （切换扫描、增删改标签等）不会把已显示的值清成 "---"。
        foreach (var r in results)
        {
            if (r.Index < 0 || r.Index >= _tags.Count) continue;
            _tags[r.Index].Value = r.Value;
            _tags[r.Index].Quality = r.Quality;
            _tags[r.Index].Timestamp = r.Timestamp;
        }

        // Build a compact update array（数值标签按工程量缩放：显示值 = 原始值 × Scale + Offset）
        var updates = results.Select(r => new
        {
            index = r.Index,
            value = ApplyScaling(r),
            quality = r.Quality.ToString(),
            errorMessage = r.ErrorMessage,
            timestamp = r.Timestamp
        }).ToList();

        SendToJs(new { type = "dataUpdated", results = updates });
    }

    /// <summary>工程量缩放：原始值 → 显示值（仅数值标签、且设置了非默认缩放时）</summary>
    private object? ApplyScaling(TagScanResult r)
    {
        if (r.Value == null || r.Index < 0 || r.Index >= _tags.Count) return r.Value;
        var tag = _tags[r.Index];
        if (!tag.HasScaling || tag.DataType == TagDataType.Bool) return r.Value;
        try
        {
            double raw = Convert.ToDouble(r.Value);
            return Math.Round(raw * tag.Scale + tag.Offset, 6);
        }
        catch { return r.Value; }
    }

    private void OnScanTime(double ms)
    {
        SendToJs(new { type = "scanTime", ms });
    }

    // ── JS -> C# Message Handler ────────────────────────────

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.WebMessageAsJson;
            // WebView2 wraps strings in quotes, unwrap if needed
            if (json.StartsWith('"') && json.EndsWith('"'))
                json = JsonSerializer.Deserialize<string>(json) ?? json;

            var msg = JsonSerializer.Deserialize<JsonElement>(json);

            if (!msg.TryGetProperty("action", out var actionProp))
                return;

            var action = actionProp.GetString();
            switch (action)
            {
                case "connect":
                    await HandleConnect(msg);
                    break;
                case "disconnect":
                    await HandleDisconnect();
                    break;
                case "addTag":
                    HandleAddTag(msg);
                    break;
                case "editTag":
                    HandleEditTag(msg);
                    break;
                case "deleteTag":
                    HandleDeleteTag(msg);
                    break;
                case "writeValue":
                    HandleWriteValue(msg);
                    break;
                case "saveConfig":
                    HandleSaveConfig();
                    break;
                case "loadConfig":
                    await HandleLoadConfig();
                    break;
                case "importTags":
                    await HandleImportTags();
                    break;
                case "exportTags":
                    await HandleExportTags();
                    break;
                case "saveConfigAs":
                    HandleSaveConfigAs(msg);
                    break;
                case "toggleScan":
                    HandleToggleScan(msg);
                    break;
                case "setScanInterval":
                    HandleSetScanInterval(msg);
                    break;
                case "refreshNow":
                    _plc.RefreshNow();
                    break;
                case "refreshSerialPorts":
                    PushSerialPortsToJs();
                    break;
                case "saveScreens":
                    HandleSaveScreens(msg);
                    break;
                case "setProtocol":
                    if (msg.TryGetProperty("protocol", out var protoProp2))
                        _protocol = protoProp2.GetString() ?? "S7";
                    break;
                case "theme":
                    HandleTheme(msg);
                    break;
            }
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = ex.Message });
        }
    }

    // ── Command Handlers ────────────────────────────────────

    private async Task HandleConnect(JsonElement msg)
    {
        var protocol = msg.TryGetProperty("protocol", out var protoProp) ? protoProp.GetString() : "S7";
        _protocol = protocol ?? "S7";

        var ip = msg.TryGetProperty("ip", out var ipProp) ? ipProp.GetString() ?? "192.168.0.1" : "192.168.0.1";
        var scanInterval = msg.TryGetProperty("scanInterval", out var siProp) && siProp.ValueKind == JsonValueKind.Number
            ? siProp.GetInt32()
            : 100;

        var settings = new PlcConnectionSettings
        {
            Protocol = _protocol,
            Ip = ip,
            Port = msg.TryGetProperty("port", out var portProp) && portProp.ValueKind == JsonValueKind.Number
                ? portProp.GetInt32()
                : 502,
            UnitId = (byte)(msg.TryGetProperty("unitId", out var uidProp) && uidProp.ValueKind == JsonValueKind.Number
                ? Math.Clamp(uidProp.GetInt32(), 0, 247)
                : 1)
        };

        // 串口参数（Modbus RTU / RS485 / RS232）
        if (settings.IsSerial)
        {
            settings.SerialPort = GetString(msg, "serialPort") ?? "COM1";
            settings.BaudRate = GetInt(msg, "baudRate") ?? 9600;
            settings.DataBits = GetInt(msg, "dataBits") ?? 8;
            settings.StopBits = GetString(msg, "stopBits") ?? "One";
            settings.Parity = GetString(msg, "parity") ?? "None";
        }
        // 原始 TCP 透传：发送报文（十六进制）
        else if (settings.IsRawTcp)
        {
            settings.SendHex = GetString(msg, "sendHex") ?? "";
        }

        // 机架 / 插槽 / CPU 仅 S7 需要
        if (_protocol.Equals("S7", StringComparison.OrdinalIgnoreCase))
        {
            settings.Rack = msg.TryGetProperty("rack", out var rackProp) && rackProp.ValueKind == JsonValueKind.Number ? rackProp.GetInt32() : 0;
            settings.Slot = msg.TryGetProperty("slot", out var slotProp) && slotProp.ValueKind == JsonValueKind.Number ? slotProp.GetInt32() : 1;
            var cpuStr = msg.TryGetProperty("cpu", out var cpuProp) ? cpuProp.GetString() : "S71200";
            settings.Cpu = Enum.TryParse<S7.Net.CpuType>(cpuStr, true, out var cpuType)
                ? cpuType
                : S7.Net.CpuType.S71200;
        }

        _plc.SetConnection(settings);
        if (scanInterval >= 50) _plc.ScanInterval = scanInterval;
        _plc.SetTags([.. _tags]);

        // 记住本次表单参数（不管连接成败），下次启动自动回填
        try
        {
            _connConfigService.Save(new ConnectionConfig
            {
                Protocol = _protocol,
                Ip = ip,
                Port = settings.Port,
                UnitId = settings.UnitId,
                Rack = settings.Rack,
                Slot = settings.Slot,
                Cpu = settings.Cpu.ToString(),
                ScanInterval = scanInterval,
                SerialPort = settings.SerialPort,
                BaudRate = settings.BaudRate,
                DataBits = settings.DataBits,
                StopBits = settings.StopBits,
                Parity = settings.Parity,
                SendHex = settings.SendHex,
                // RawTcp 的 port 字段存的就是 rawPort（前端 rawFields 端口框的值）
                RawPort = settings.IsRawTcp ? settings.Port : _connConfigService.Load().RawPort
            });
        }
        catch { }

        SendToJs(new { type = "connectionChanged", connected = false, text = "连接中…", connecting = true });
        await _plc.ConnectAsync();
    }

    /// <summary>从 CSV 导入标签（追加到当前列表，不动已有标签）</summary>
    private async Task HandleImportTags()
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        picker.FileTypeFilter.Add(".csv");

        var file = await picker.PickSingleFileAsync();
        if (file == null) return;

        try
        {
            var (imported, skipped) = TagConfigService.ImportCsv(file.Path);
            var existingNames = new HashSet<string>(_tags.Select(tag => tag.Name), StringComparer.OrdinalIgnoreCase);
            int duplicateCount = imported.RemoveAll(tag => !existingNames.Add(tag.Name.Trim()));
            skipped += duplicateCount;
            if (imported.Count == 0)
            {
                string message = duplicateCount > 0
                    ? "没有可导入的新标签，重复名称已跳过"
                    : "CSV 中没有可导入的有效标签";
                SendToJs(new { type = "error", text = message });
                return;
            }
            _tags.AddRange(imported);
            _plc.SetTags([.. _tags]);
            await PushTagsToJs();
            string msg = $"已导入 {imported.Count} 个标签";
            if (skipped > 0) msg += $"（跳过 {skipped} 行无效或重名数据）";
            SendToJs(new { type = "toast", text = msg, kind = "success" });
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = $"导入失败：{ex.Message}" });
        }
    }

    /// <summary>把当前标签列表导出为 CSV</summary>
    private async Task HandleExportTags()
    {
        if (_tags.Count == 0)
        {
            SendToJs(new { type = "error", text = "当前没有标签可导出" });
            return;
        }

        var picker = new Windows.Storage.Pickers.FileSavePicker();
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        picker.FileTypeChoices.Add("CSV 文件", [".csv"]);
        picker.SuggestedFileName = "pulse_tags";

        var file = await picker.PickSaveFileAsync();
        if (file == null) return;

        try
        {
            TagConfigService.ExportCsv([.. _tags], file.Path);
            SendToJs(new { type = "toast", text = $"已导出 {_tags.Count} 个标签到：{file.Path}", kind = "success" });
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = $"导出失败：{ex.Message}" });
        }
    }

    private void HandleSaveScreens(JsonElement msg)
    {
        try
        {
            var raw = msg.GetProperty("screens").GetRawText();
            _screenConfig.Save(raw);
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = $"保存画面失败：{ex.Message}" });
        }
    }

    private void HandleTheme(JsonElement msg)
    {
        var theme = msg.TryGetProperty("theme", out var t) ? t.GetString() : "light";
        bool dark = theme == "dark";
        RootGrid.Background = new SolidColorBrush(dark
            ? Microsoft.UI.ColorHelper.FromArgb(255, 0x0d, 0x11, 0x17)
            : Microsoft.UI.ColorHelper.FromArgb(255, 0xf8, 0xf9, 0xfb));
        SetTitlebarTheme(dark);
    }

    private async Task HandleDisconnect()
    {
        await _plc.DisconnectAsync();
    }

    private void HandleAddTag(JsonElement msg)
    {
        var tagProp = msg.GetProperty("tag");
        var tag = ParseTagFromJson(tagProp);
        if (tag == null) return;
        if (HasDuplicateTagName(tag.Name))
        {
            SendToJs(new { type = "error", text = $"标签名称“{tag.Name}”已存在，请使用唯一名称" });
            return;
        }

        _tags.Add(tag);
        _plc.SetTags([.. _tags]);
        _ = PushTagsToJs();
    }

    private void HandleEditTag(JsonElement msg)
    {
        var index = msg.GetProperty("index").GetInt32();
        if (index < 0 || index >= _tags.Count) return;

        var tagProp = msg.GetProperty("tag");
        var tag = ParseTagFromJson(tagProp);
        if (tag == null) return;
        if (HasDuplicateTagName(tag.Name, index))
        {
            SendToJs(new { type = "error", text = $"标签名称“{tag.Name}”已存在，请使用唯一名称" });
            return;
        }

        _tags[index] = tag;
        _plc.SetTags([.. _tags]);
        _ = PushTagsToJs();
    }

    private bool HasDuplicateTagName(string name, int exceptIndex = -1)
    {
        for (int i = 0; i < _tags.Count; i++)
        {
            if (i != exceptIndex && string.Equals(_tags[i].Name.Trim(), name.Trim(), StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    private void HandleDeleteTag(JsonElement msg)
    {
        var index = msg.GetProperty("index").GetInt32();
        if (index < 0 || index >= _tags.Count) return;

        _tags.RemoveAt(index);
        _plc.SetTags([.. _tags]);
        _ = PushTagsToJs();
    }

    private void HandleWriteValue(JsonElement msg)
    {
        var index = msg.GetProperty("index").GetInt32();
        if (index < 0 || index >= _tags.Count) return;

        var tag = _tags[index];
        var valueProp = msg.GetProperty("value");
        if (valueProp.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            SendToJs(new { type = "error", text = $"{tag.Name}: 值无效" });
            return;
        }

        // 工程量反变换：用户输入的是显示值，写回 PLC 前要还原成原始值
        if (tag.HasScaling && tag.DataType != TagDataType.Bool && tag.Scale != 0
            && valueProp.ValueKind == JsonValueKind.Number)
        {
            double eng = valueProp.GetDouble();
            valueProp = JsonSerializer.SerializeToElement((eng - tag.Offset) / tag.Scale);
        }

        object value;
        try
        {
            value = tag.DataType switch
            {
                TagDataType.Bool  => valueProp.ValueKind is JsonValueKind.True or JsonValueKind.False
                                        ? valueProp.GetBoolean()
                                        : valueProp.GetDouble() != 0,
                // 用 long/double 中转，避免 DWord(>2^31) / Word 等无符号值在 GetInt32 上溢出
                TagDataType.Byte  => (byte)(ReadAsLong(valueProp) & 0xFF),
                TagDataType.Word  => (ushort)(ReadAsLong(valueProp) & 0xFFFF),
                TagDataType.DWord => (uint)(ReadAsLong(valueProp) & 0xFFFFFFFF),
                TagDataType.Int   => (short)(ReadAsLong(valueProp) & 0xFFFF),
                TagDataType.DInt  => (int)(ReadAsLong(valueProp) & 0xFFFFFFFF),
                TagDataType.Real  => (float)valueProp.GetDouble(),
                _                 => (int)ReadAsLong(valueProp)
            };
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = $"{tag.Name}: 值无法转换（{ex.Message}）" });
            return;
        }

        // 写入移到后台线程执行（WriteTag 现在内部持 _commLock），
        // 避免阻塞 UI 线程 / 与扫描循环并发读写同一个 S7 连接。
        _ = Task.Run(() =>
        {
            var (success, message) = _plc.WriteTag(tag, value);
            DispatcherQueue.TryEnqueue(() =>
            {
                if (!success)
                {
                    SendToJs(new { type = "error", text = $"{tag.Name}: {message}" });
                }
                else
                {
                    SendToJs(new { type = "toast", text = $"{tag.Name}: 写入成功", kind = "success" });
                }
            });
        });
    }

    /// <summary>JSON 数值读成 long（浮点中转，兼容 DWord 等无符号大值）</summary>
    private static long ReadAsLong(JsonElement el)
    {
        if (el.ValueKind == JsonValueKind.Number) return (long)el.GetDouble();
        if (el.ValueKind == JsonValueKind.String && long.TryParse(el.GetString(), out var v)) return v;
        throw new FormatException($"无法解析数值: {el}");
    }

    /// <summary>运行中修改扫描周期，立即生效（无需重连）</summary>
    private void HandleSetScanInterval(JsonElement msg)
    {
        if (!msg.TryGetProperty("ms", out var msProp) || msProp.ValueKind != JsonValueKind.Number) return;
        var ms = msProp.GetInt32();
        if (ms < 50) ms = 50;
        if (ms > 10000) ms = 10000;
        _plc.ScanInterval = ms;
    }

    private void HandleSaveConfig()
    {
        try
        {
            _configService.Save([.. _tags]);
            SendToJs(new { type = "toast", text = "标签配置已保存", kind = "success" });
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = $"保存失败：{ex.Message}" });
        }
    }

    private async Task HandleLoadConfig()
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        picker.FileTypeFilter.Add(".json");

        var file = await picker.PickSingleFileAsync();
        if (file == null) return;

        try
        {
            var tags = _configService.Load(file.Path);
            _tags.Clear();
            _tags.AddRange(tags);
            _plc.SetTags([.. _tags]);
            await PushTagsToJs();
            SendToJs(new { type = "toast", text = $"已加载配置（{_tags.Count} 个标签）", kind = "success" });
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = $"加载失败：{ex.Message}" });
        }
    }

    private void HandleSaveConfigAs(JsonElement msg)
    {
        var path = msg.GetProperty("path").GetString();
        if (string.IsNullOrEmpty(path)) return;

        try
        {
            _configService.Save([.. _tags], path);
            SendToJs(new { type = "toast", text = $"已保存到：{path}", kind = "success" });
        }
        catch (Exception ex)
        {
            SendToJs(new { type = "error", text = $"保存失败：{ex.Message}" });
        }
    }

    private void HandleToggleScan(JsonElement msg)
    {
        var index = msg.GetProperty("index").GetInt32();
        if (index < 0 || index >= _tags.Count) return;

        _tags[index].ScanEnabled = !_tags[index].ScanEnabled;
        _plc.SetTags([.. _tags]);
        _ = PushTagsToJs();
    }

    // ── Helper: 读取 JSON 消息属性 ──────────────────────────

    private static string? GetString(JsonElement msg, string name) =>
        msg.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    private static int? GetInt(JsonElement msg, string name) =>
        msg.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : null;

    // ── Helper: Parse TagConfig from JSON ───────────────────

    private TagConfig? ParseTagFromJson(JsonElement prop)
    {
        var name = prop.GetProperty("name").GetString();
        var address = prop.GetProperty("address").GetString()?.ToUpper();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(address))
            return null;

        var dataTypeStr = prop.GetProperty("dataType").GetString() ?? "Bool";
        var dataType = Enum.TryParse<TagDataType>(dataTypeStr, true, out var dt) ? dt : TagDataType.Bool;
        var group = prop.TryGetProperty("group", out var g) ? g.GetString() ?? "Default" : "Default";
        var comment = prop.TryGetProperty("comment", out var c) ? c.GetString() ?? "" : "";
        var scanEnabled = prop.TryGetProperty("scanEnabled", out var se) && se.GetBoolean();

        var tag = new TagConfig
        {
            Name = name,
            Address = address,
            DataType = dataType,
            Group = group,
            Comment = comment,
            ScanEnabled = scanEnabled,
            Scale = prop.TryGetProperty("scale", out var sc) && sc.ValueKind == JsonValueKind.Number ? sc.GetDouble() : 1,
            Offset = prop.TryGetProperty("offset", out var of) && of.ValueKind == JsonValueKind.Number ? of.GetDouble() : 0
        };

        // 地址只用于确定区域 / 偏移 / 位号；数据类型以显式选择为准
        // （地址后缀推导出的类型仅作为弹窗里的默认建议）
        // 按当前协议选用对应的地址解析器
        bool parsed;
        if (_protocol.Equals("ModbusTcp", StringComparison.OrdinalIgnoreCase)
            || _protocol.Equals("ModbusRtu", StringComparison.OrdinalIgnoreCase))
        {
            parsed = ModbusAddressParser.ParseToTag(address, tag);
        }
        else if (_protocol.Equals("RawTcp", StringComparison.OrdinalIgnoreCase))
        {
            // 原始 TCP：地址即响应数据中的字节偏移
            parsed = int.TryParse(address, out var rawOffset) && rawOffset >= 0;
            if (parsed)
            {
                tag.Area = Area.RawData;
                tag.DbNumber = 0;
                tag.ByteOffset = rawOffset;
                tag.BitOffset = 0;
            }
        }
        else
        {
            parsed = AddressParser.ParseToTag(address, tag);
        }
        if (!parsed)
        {
            SendToJs(new { type = "error", text = $"地址无法解析：{address}" });
            return null;
        }

        tag.DataType = dataType;
        return tag;
    }

    // ── Helper: Push full tag list to JS ────────────────────

    private async Task PushTagsToJs()
    {
        var tagData = _tags.Select((t, i) => new
        {
            name = t.Name,
            address = t.Address,
            area = t.Area.ToString(),
            dataType = t.DataType.ToString(),
            dbNumber = t.DbNumber,
            byteOffset = t.ByteOffset,
            bitOffset = t.BitOffset,
            group = t.Group,
            comment = t.Comment,
            scanEnabled = t.ScanEnabled,
            scale = t.Scale,
            offset = t.Offset,
            value = t.Value,
            quality = t.Quality.ToString(),
            timestamp = t.Timestamp
        }).ToList();

        SendToJs(new { type = "tagsChanged", tags = tagData });
        await Task.CompletedTask;
    }

    // ── JS Interop Helpers ──────────────────────────────────

    /// <summary>
    /// Send a structured message to the JS frontend via PostWebMessageAsJson.
    /// This avoids string-eval'ing JS and eliminates all escaping issues.
    /// </summary>
    private void SendToJs(object payload)
    {
        try
        {
            if (WebView.CoreWebView2 != null)
                WebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload, JsonOpts));
        }
        catch { }
    }
}
