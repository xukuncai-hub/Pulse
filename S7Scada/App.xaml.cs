using System.Diagnostics;
using Microsoft.UI.Xaml;
using S7Scada.Services;
using S7Scada.Views;

namespace S7Scada;

public partial class App : Application
{
    private Window? _window;
    private PlcService? _plcService;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _plcService = new PlcService();
        var configService = new TagConfigService();

        _window = new MainWindow(_plcService, configService);
        _window.Closed += (s, e) => _plcService?.Dispose();
        _window.Activate();                                // 先显示：WebView2 需先进入可视树、hwnd 才有效
        ((MainWindow)_window).ApplyInitialTitlebarTheme(); // 默认浅色，theme 消息会再设置
        _ = InitializeAsync((MainWindow)_window);          // 后初始化 WebView2
    }

    private async Task InitializeAsync(MainWindow window)
    {
        try
        {
            await window.InitializeAsync();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Init failed: {ex}");
            // 保持应用存活；桥接异常会由前端 toast 暴露
        }
    }
}
