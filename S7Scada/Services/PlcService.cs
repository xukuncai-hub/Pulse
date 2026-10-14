using System.Diagnostics;
using System.Threading;
using S7Scada.Models;

namespace S7Scada.Services;

/// <summary>
/// PLC 通信服务：负责连接生命周期、扫描节拍与事件分发。
/// 具体协议的读写交给 IPlcDriver（S7 / Modbus TCP），本类不感知协议细节。
/// </summary>
public class PlcService : IDisposable
{
    private IPlcDriver? _driver;
    private readonly object _lock = new();
    private readonly object _commLock = new(); // 串行化 PLC 通信（扫描循环与手动刷新 / 写入）
    private CancellationTokenSource? _cts;
    private Task? _scanTask;
    private volatile int _connecting; // 0=空闲, 1=正在连接（Interlocked 原子保护，防止并发双连）
    private volatile bool _connected;
    private volatile bool _errorAlreadyReported; // 本次连接尝试的失败原因是否已上报过

    // 事件
    public event Action? Connected;
    public event Action<string>? Disconnected;
    public event Action<string>? ConnectionError;
    public event Action<PlcInfo>? PlcInfoReceived;
    public event Action<List<TagScanResult>>? DataUpdated;
    public event Action<double>? ScanTime;

    // 属性
    public bool IsConnected => _connected;
    public PlcConnectionSettings Settings { get; private set; } = new();
    public int ScanInterval { get; set; } = 100;

    private List<TagConfig> _tags = [];

    /// <summary>设置连接参数（协议、IP、端口、机架/插槽、CPU 等）</summary>
    public void SetConnection(PlcConnectionSettings settings) => Settings = settings;

    /// <summary>设置要扫描的标签列表</summary>
    public void SetTags(List<TagConfig> tags)
    {
        lock (_lock)
        {
            _tags = [.. tags];
        }
    }

    /// <summary>连接 PLC 并启动扫描</summary>
    public async Task ConnectAsync()
    {
        if (_connected) return;
        // 原子 CAS：如果已在连接中（_connecting==1），直接返回，防止并发双连
        if (Interlocked.CompareExchange(ref _connecting, 1, 0) != 0) return;

        try
        {
            _cts?.Dispose();
            _cts = new CancellationTokenSource();
            _scanTask = Task.Run(() => ScanLoopAsync(_cts.Token));
            await Task.CompletedTask;
        }
        finally
        {
            _connecting = 0;
        }
    }

    /// <summary>断开 PLC</summary>
    public async Task DisconnectAsync()
    {
        _cts?.Cancel();
        var task = _scanTask;
        _scanTask = null;
        if (task != null)
        {
            // 扫描循环收尾时会统一清理连接并触发一次 Disconnected
            try { await task; } catch { }
            return;
        }
        DisconnectInternal();
    }

    /// <summary>立即手动刷新一次全部标签（不改变持续扫描的状态）</summary>
    public void RefreshNow()
    {
        var driver = _driver;
        if (!_connected || driver == null) return;

        _ = Task.Run(() =>
        {
            List<TagConfig> snapshot;
            lock (_lock) { snapshot = [.. _tags]; }
            if (snapshot.Count == 0) return;

            List<TagScanResult> results;
            lock (_commLock) { results = ScanAll(driver, snapshot); }

            if (results.Count > 0)
                DataUpdated?.Invoke(results);
        });
    }

    /// <summary>写入标签值到 PLC</summary>
    public (bool Success, string Message) WriteTag(TagConfig tag, object value)
    {
        // 与扫描循环共用串行锁，避免并发读写同一条连接
        lock (_commLock)
        {
            var driver = _driver;
            if (!_connected || driver == null)
                return (false, "PLC 未连接");

            return driver.Write(tag, value);
        }
    }

    public void Dispose()
    {
        _cts?.Cancel();
        DisconnectInternal();
        GC.SuppressFinalize(this);
    }

    // ── 私有方法 ────────────────────────────────────────

    private static List<TagScanResult> ScanAll(IPlcDriver driver, List<TagConfig> tags)
    {
        string timestamp = DateTime.Now.ToString("HH:mm:ss.fff");
        var indexed = tags.Select((tag, idx) => (idx, tag)).ToList();
        return driver.Scan(indexed, timestamp);
    }

    private async Task ScanLoopAsync(CancellationToken ct)
    {
        try
        {
            // 单次连接尝试：失败即停止，由用户手动重新点击"连接"
            if (!await TryConnectOnceAsync(ct))
            {
                DisconnectInternal();
                return;
            }

            // 连接成功后持续扫描；连接断开时停止，不做自动重连。
            // 采用基于 deadline 的固定节拍：等待时间 = 周期 - 本次扫描耗时，
            // 避免"扫描耗时 + 间隔"逐周期累积造成的节拍漂移。
            var clock = Stopwatch.StartNew();
            long nextDueMs = clock.ElapsedMilliseconds + Math.Max(ScanInterval, 1);
            while (!ct.IsCancellationRequested && _connected)
            {
                // 每轮读取当前周期，支持运行中热更新扫描间隔
                long intervalMs = Math.Max(ScanInterval, 1);
                var driver = _driver;

                List<TagConfig> snapshot;
                lock (_lock) { snapshot = [.. _tags]; }

                if (driver != null && snapshot.Count > 0)
                {
                    var sw = Stopwatch.StartNew();
                    List<TagScanResult> results;
                    lock (_commLock) { results = ScanAll(driver, snapshot); }
                    sw.Stop();
                    ScanTime?.Invoke(sw.Elapsed.TotalMilliseconds);

                    if (results.Count > 0)
                        DataUpdated?.Invoke(results);
                }

                // 连接已断开则停止扫描（不自动重连）
                // 注意：不在此处触发 Disconnected 事件，统一由 DisconnectInternal 触发，避免双重触发
                if (driver == null || !driver.IsConnected)
                {
                    break;
                }

                long now = clock.ElapsedMilliseconds;
                if (now < nextDueMs)
                {
                    await Task.Delay((int)(nextDueMs - now), ct);
                    nextDueMs += intervalMs;
                }
                else
                {
                    // 本次扫描已超过一个周期：重置节拍基准，不补偿积压
                    nextDueMs = clock.ElapsedMilliseconds + intervalMs;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Debug.WriteLine($"PLC error: {ex.Message}");
        }

        DisconnectInternal();
    }

    private void DisconnectInternal()
    {
        // 连接失败时 ConnectionError 已经把失败原因推给界面，
        // 这里不再紧跟一条 Disconnected 把状态文字覆盖回去（保留失败原因可见）。
        bool errorAlreadyReported = _errorAlreadyReported;
        _errorAlreadyReported = false;

        _connected = false;

        // 关闭连接与置空必须在 _commLock 内完成：
        // 否则扫描/写入线程可能正持锁使用驱动，出现空引用或整组读取失败
        lock (_commLock)
        {
            try { _driver?.Close(); } catch { }
            try { _driver?.Dispose(); } catch { }
            _driver = null;
        }

        if (!errorAlreadyReported)
            Disconnected?.Invoke("Disconnected");
    }

    /// <summary>
    /// 尝试连接一次。Open() 是阻塞调用，这里给它包一层超时，
    /// 避免 IP 不可达时界面一直卡在 "Connecting..." 等操作系统级的 TCP 超时。
    /// 返回 true 表示连接成功。
    /// </summary>
    private async Task<bool> TryConnectOnceAsync(CancellationToken ct)
    {
        int timeoutMs = Math.Max(1000, Settings.ConnectTimeoutMs);
        IPlcDriver? driver = null;

        try
        {
            driver = CreateDriver(Settings.Protocol);
            _driver = driver;

            var local = driver;
            var openTask = Task.Run(() => local.Open(Settings), ct);
            var done = await Task.WhenAny(openTask, Task.Delay(timeoutMs, ct));

            if (done == openTask)
            {
                await openTask; // rethrow if Open() failed
                _connected = true;
                Connected?.Invoke();

                // 异步获取设备信息
                _ = Task.Run(() => PlcInfoReceived?.Invoke(local.GetInfo(Settings)), ct);
                return true;
            }

            // 连接超时或用户已取消（取消时不上报错误）
            if (!ct.IsCancellationRequested)
            {
                _errorAlreadyReported = true;
                ConnectionError?.Invoke($"连接超时（{timeoutMs / 1000} 秒内无响应）");
            }
            return false;
        }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
            {
                _errorAlreadyReported = true;
                ConnectionError?.Invoke(IPlcDriver.FriendlyError(ex));
            }
            return false;
        }
        finally
        {
            // 未连上时清理驱动（Open 可能仍阻塞在后台线程，Close 会让它抛错退出）
            if (!_connected)
            {
                try { driver?.Close(); } catch { }
                try { driver?.Dispose(); } catch { }
                lock (_commLock) { _driver = null; }
            }
        }
    }

    /// <summary>按协议标识创建驱动（只有两个协议，硬编码即可，不做插件化）</summary>
    private static IPlcDriver CreateDriver(string? protocol) =>
        string.Equals(protocol, "ModbusTcp", StringComparison.OrdinalIgnoreCase)
            ? new ModbusDriver()
            : new S7Driver();
}
