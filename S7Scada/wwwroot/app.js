/* ================================================================
   Pulse — JavaScript Bridge & UI Controller
   ================================================================ */

// ── State ─────────────────────────────────────────────────────
var state = {
    connected: false,
    tags: [],
    plcInfo: null,
    scanTime: 0,
    contextTagIndex: -1,
    editingTagIndex: -1,
    editorTypeTouched: false, // 用户是否手动改过"数据类型"下拉
    view: 'table',
    screens: [],
    currentScreen: -1,
    selectedWidgets: [],   // 当前选中的组件 id 列表（支持多选）
    clipboard: null,       // 复制板（组件深拷贝）
    preview: false,        // 预览（运行）模式
    snap: true,            // 拖动 / 缩放吸附到 10px 网格
    showGrid: true,        // 显示网格
    // Cached DOM element references (avoid repeated getElementById per scan)
    dashValEls: {},
    tblValEls: {},
    tblQBadges: {},
    tblTimeEls: {}
};

// Filter state (search + group)
var filter = { search: '', group: 'All' };

// ── Theme Toggle ──────────────────────────────────────────────
function applyTheme(theme) {
    var html = document.documentElement;
    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }
    var sunIcon = document.querySelector('#btnTheme .icon-sun');
    var moonIcon = document.querySelector('#btnTheme .icon-moon');
    if (sunIcon && moonIcon) {
        sunIcon.style.display = theme === 'dark' ? 'none' : '';
        moonIcon.style.display = theme === 'dark' ? '' : 'none';
    }
    // 区域 / 数据类型配色来自 CSS 变量，切主题后需要重绘列表才能取到新值
    if (state.tags.length) {
        renderDashboard();
        renderTable();
    }
    // Notify the WPF window so its chrome background matches the theme
    postToCSharp({ action: 'theme', theme: theme });
}

function toggleTheme() {
    var current = localStorage.getItem('scada-theme') || 'light';
    var next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('scada-theme', next);
    applyTheme(next);
}

(function initTheme() {
    var saved = localStorage.getItem('scada-theme') || 'light';
    applyTheme(saved);
})();

// ── Area & Type Colors ────────────────────────────────────────
// 统一从 CSS 变量读取（明/暗主题各自取值），避免深色模式下硬编码色对比度不足
function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

var COLOR_FALLBACK = '#2563eb';

function areaColor(area) {
    var key = String(area || 'M');
    // Modbus 的四个寄存器区共用一个配色令牌
    if (key.indexOf('Modbus') === 0) key = 'modbus';
    return getCssVar('--area-' + key.toLowerCase()) || COLOR_FALLBACK;
}

function typeColor(dataType) {
    return getCssVar('--type-' + String(dataType || 'Bool').toLowerCase()) || COLOR_FALLBACK;
}

// ── Window Controls ───────────────────────────────────────────
// 原生标题栏负责最小化/最大化/关闭与拖动，无需自定义处理。

// ── Toast System ──────────────────────────────────────────────
var toastContainer = null;

function ensureToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

function showToast(message, type) {
    type = type || 'info';
    var container = ensureToastContainer();
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
        toast.style.animation = 'toast-out 0.25s ease-in forwards';
        setTimeout(function () { toast.remove(); }, 250);
    }, 3500);
}

// ── C# -> JS API (window callbacks) ──────────────────────────

window.onConnectionChanged = function (connected, statusText, connecting) {
    state.connected = connected;
    updateConnectionUI(connected, statusText, connecting);
};

window.onPlcInfo = function (info) {
    state.plcInfo = info;
    updatePlcInfoUI(info);
};

// 应用名与版本（由 C# 侧从程序集读取后下发，避免与 exe 版本两处不一致）
window.onAppInfo = function (msg) {
    if (!msg || !msg.version) return;
    var el = document.querySelector('.about-ver');
    if (el) el.textContent = (msg.name || 'Pulse') + ' · 版本 v' + msg.version;
};

window.onDataUpdated = function (results) {
    if (!results || !Array.isArray(results)) return;
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (r.index >= 0 && r.index < state.tags.length) {
            state.tags[r.index].value = r.value;
            state.tags[r.index].quality = r.quality;
            state.tags[r.index].timestamp = r.timestamp;
        }
    }
    updateDashboardValues();
    updateTableValues();
    updateScreenWidgets();
};

window.onScanTime = function (ms) {
    state.scanTime = ms;
    var el = document.getElementById('statusScanTime');
    if (el) el.textContent = '扫描: ' + ms.toFixed(1) + ' ms';
};

window.onTagsChanged = function (tags) {
    state.tags = tags || [];
    renderDashboard();
    renderTable();
    updateTagCount();
    renderProps(); // 组件绑定下拉随标签增删刷新
};

window.onError = function (message) {
    showToast(message, 'error');
};

// ── JS -> C# Bridge ──────────────────────────────────────────

function postToCSharp(obj) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(obj));
    }
}

// ── C# -> JS message listener (PostWebMessageAsJson) ─────────
// All real-time data now arrives as structured JSON messages instead
// of eval'd JS strings.
if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', function (e) {
        var msg = e.data;
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case 'connectionChanged': window.onConnectionChanged(msg.connected, msg.text, !!msg.connecting); break;
            case 'plcInfo':           window.onPlcInfo(msg.info); break;
            case 'appInfo':           window.onAppInfo(msg); break;
            case 'dataUpdated':       window.onDataUpdated(msg.results); break;
            case 'scanTime':          window.onScanTime(msg.ms); break;
            case 'tagsChanged':       window.onTagsChanged(msg.tags); break;
            case 'screensChanged':    window.onScreensChanged(msg.screens); break;
            case 'windowMetrics':     window.onWindowMetrics(msg); break;
            case 'toast':             showToast(msg.text, msg.kind || 'info'); break;
            case 'error':             showToast(msg.text, 'error'); break;
            default: break;
        }
    });
}

function connectPlc() {
    var protocol = currentProtocol();
    var isModbus = protocol === 'ModbusTcp';
    var ip = document.getElementById('inputIp').value.trim();
    var scanInterval = parseInt(document.getElementById('inputScan').value) || 500;

    if (!ip) {
        showToast('请先填写 PLC 的 IP 地址', 'error');
        document.getElementById('inputIp').focus();
        return;
    }
    if (/[^0-9a-zA-Z.\-:]/.test(ip)) {
        showToast('IP 地址格式不正确：' + ip, 'error');
        document.getElementById('inputIp').focus();
        return;
    }

    // 侧边栏标题同步显示实际连接的地址（之前一直写死 192.168.0.1）
    var connIp = document.getElementById('connIp');
    if (connIp) connIp.textContent = ip;

    var payload = {
        action: 'connect',
        protocol: protocol,
        ip: ip,
        scanInterval: scanInterval
    };
    if (isModbus) {
        payload.port = parseInt(document.getElementById('inputPort').value) || 502;
        payload.unitId = parseInt(document.getElementById('inputUnit').value) || 1;
    } else {
        payload.rack = parseInt(document.getElementById('inputRack').value) || 0;
        payload.slot = parseInt(document.getElementById('inputSlot').value) || 1;
        payload.cpu = document.getElementById('inputCpu').value;
    }
    postToCSharp(payload);
}

// ── 协议切换 ──────────────────────────────────────────────────
function currentProtocol() {
    var el = document.getElementById('inputProtocol');
    return el ? el.value : 'S7';
}

function onProtocolChanged() {
    var protocol = currentProtocol();
    var isModbus = protocol === 'ModbusTcp';

    // 表单：Modbus 用端口 / 从站号，S7 用 CPU / 机架 / 插槽
    var s7 = document.getElementById('s7Fields');
    if (s7) s7.style.display = isModbus ? 'none' : '';
    var mb = document.getElementById('modbusFields');
    if (mb) mb.style.display = isModbus ? '' : 'none';

    // 侧边栏信息卡：两种协议各显示对应的设置提示
    var tia = document.getElementById('tiaCard');
    if (tia) tia.style.display = isModbus ? 'none' : '';
    var mbc = document.getElementById('modbusCard');
    if (mbc) mbc.style.display = isModbus ? '' : 'none';

    // 标签地址输入提示随协议变化
    var addr = document.getElementById('editorAddress');
    if (addr) addr.placeholder = isModbus ? '例如：HR100 / 40001 / CO0' : '例如：DB1.DBW2';
    var preview = document.getElementById('editorPreview');
    if (preview) { preview.textContent = '输入地址后自动解析…'; preview.className = 'field-preview'; }

    // 通知 C# 侧当前协议，新增/编辑标签时按此选择地址解析器
    postToCSharp({ action: 'setProtocol', protocol: protocol });
}

// Modbus 区域中文名
function areaLabel(a) {
    if (a === 'HR') return '保持寄存器(4x)';
    if (a === 'IR') return '输入寄存器(3x)';
    if (a === 'CO') return '线圈(0x)';
    if (a === 'DI') return '离散输入(1x)';
    return a;
}

function disconnectPlc() {
    postToCSharp({ action: 'disconnect' });
}

// 宿主告知的系统窗口按钮宽度（逻辑像素 = CSS px），用于工具栏右侧预留，
// 避免内容压到最小化/最大化/关闭按钮下面。平台值缺失时回退到 CSS 默认值。
window.onWindowMetrics = function (m) {
    if (!m || typeof m.rightInset !== 'number') return;
    var inset = Math.round(m.rightInset);
    if (inset > 0) {
        document.documentElement.style.setProperty('--winctl-w', (inset + 6) + 'px');
    }
};

function addTag(tag) {
    postToCSharp({ action: 'addTag', tag: tag });
}

function editTag(index, tag) {
    postToCSharp({ action: 'editTag', index: index, tag: tag });
}

function deleteTag(index) {
    postToCSharp({ action: 'deleteTag', index: index });
}

function writeValue(index, value) {
    postToCSharp({ action: 'writeValue', index: index, value: value });
}

function saveConfig() {
    postToCSharp({ action: 'saveConfig' });
}

function loadConfig() {
    postToCSharp({ action: 'loadConfig' });
}

function saveConfigAs(path) {
    postToCSharp({ action: 'saveConfigAs', path: path });
}

function toggleScan(index) {
    postToCSharp({ action: 'toggleScan', index: index });
}

function refreshNow() {
    postToCSharp({ action: 'refreshNow' });
}

// ── Connection UI ─────────────────────────────────────────────

function updateConnectionUI(connected, statusText, connecting) {
    var header = document.getElementById('connHeader');
    var led = document.getElementById('connLed');
    var statusEl = document.getElementById('connStatus');
    var toolbarDot = document.getElementById('toolbarStatusDot');
    var toolbarText = document.getElementById('toolbarStatusText');
    var toolbarPill = document.getElementById('toolbarStatus');
    var statusDot = document.getElementById('statusDot');
    var statusTextEl = document.getElementById('statusText');
    var btnConnToolbar = document.getElementById('btnConnectToolbar');
    var btnDisconnToolbar = document.getElementById('btnDisconnectToolbar');
    var btnConnSidebar = document.getElementById('btnConnectSidebar');
    var btnDisconnSidebar = document.getElementById('btnDisconnectSidebar');
    var plcDetail = document.getElementById('plcDetail');

    connecting = !!connecting;
    var label = statusText || (connecting ? '连接中…' : (connected ? '已连接' : '未连接'));
    var failed = !connected && !connecting && /失败|fail/i.test(label);

    // Toggle connected / connecting classes (amber pulse while attempting)
    header.classList.toggle('connected', connected);
    header.classList.toggle('connecting', connecting);
    led.classList.toggle('connected', connected);
    led.classList.toggle('connecting', connecting);
    statusEl.classList.toggle('connected', connected);
    statusDot.classList.toggle('connected', connected);
    statusDot.classList.toggle('connecting', connecting);
    toolbarDot.classList.toggle('connected', connected);
    toolbarDot.classList.toggle('connecting', connecting);

    // 工具栏状态胶囊随状态配色
    if (toolbarPill) {
        toolbarPill.classList.toggle('is-connected', connected);
        toolbarPill.classList.toggle('is-connecting', connecting);
        toolbarPill.classList.toggle('is-failed', failed);
    }

    // Status text
    statusEl.textContent = label;
    toolbarText.textContent = label;
    statusTextEl.textContent = label;
    if (statusEl) statusEl.title = label;

    // Statusbar left parent
    var sbl = document.querySelector('.sb-left');
    if (sbl) {
        sbl.classList.toggle('connected', connected);
        sbl.classList.toggle('connecting', connecting);
    }

    // Button visibility + disable Connect while an attempt is in flight
    btnConnToolbar.style.display = connected ? 'none' : '';
    btnConnToolbar.disabled = connecting;
    btnDisconnToolbar.style.display = connected ? '' : 'none';
    btnConnSidebar.style.display = connected ? 'none' : '';
    btnConnSidebar.disabled = connecting;
    btnDisconnSidebar.style.display = connected ? '' : 'none';

    // 连接按钮在尝试期间显示"连接中…"，给出明确的进行中反馈
    var btnConnSidebarLabel = btnConnSidebar.querySelector('.btn-label');
    if (btnConnSidebarLabel) btnConnSidebarLabel.textContent = connecting ? '连接中…' : '连接 PLC';
    var btnConnToolbarLabel = btnConnToolbar.querySelector('.btn-label');
    if (btnConnToolbarLabel) btnConnToolbarLabel.textContent = connecting ? '连接中…' : '连接';

    // Input disable state
    document.getElementById('inputIp').disabled = connected;
    document.getElementById('inputCpu').disabled = connected;
    document.getElementById('inputRack').disabled = connected;
    document.getElementById('inputSlot').disabled = connected;

    // PLC detail section
    plcDetail.style.display = connected ? '' : 'none';
}

function updatePlcInfoUI(info) {
    if (!info) return;
    var parts = [];
    if (info.module) parts.push(info.module);
    if (info.firmwareVersion) parts.push('FW:' + info.firmwareVersion);

    var connPlcInfo = document.getElementById('connPlcInfo');
    var statusPlcInfo = document.getElementById('statusPlcInfo');
    if (connPlcInfo) connPlcInfo.textContent = parts.join(' | ');
    if (statusPlcInfo) statusPlcInfo.textContent = parts.join(' | ');

    var plcModule = document.getElementById('plcModule');
    var plcFirmware = document.getElementById('plcFirmware');
    var plcSerial = document.getElementById('plcSerial');
    if (plcModule) plcModule.textContent = info.module || '-';
    if (plcFirmware) plcFirmware.textContent = info.firmwareVersion || '-';
    if (plcSerial) plcSerial.textContent = info.serialNumber || '-';
}

// ── Tag Count ─────────────────────────────────────────────────

function updateTagCount() {
    var count = state.tags.length;
    var tagCountEl = document.getElementById('tagCount');
    var dashCountEl = document.getElementById('dashboardCount');
    var statusTagEl = document.getElementById('statusTagCount');
    if (tagCountEl) tagCountEl.textContent = String(count);
    if (dashCountEl) dashCountEl.textContent = String(count);
    if (statusTagEl) statusTagEl.textContent = '标签: ' + count;
}

// ── Dashboard Cards ───────────────────────────────────────────

function renderDashboard() {
    var section = document.getElementById('dashboardSection');
    var container = document.getElementById('dashboardCards');
    var empty = document.getElementById('emptyState');
    var tableCont = document.getElementById('tableContainer');

    if (state.tags.length === 0) {
        section.style.display = 'none';
        empty.style.display = '';
        tableCont.style.display = 'none';
        return;
    }

    section.style.display = '';
    empty.style.display = 'none';
    tableCont.style.display = '';

    container.innerHTML = '';
    state.dashValEls = {};
    for (var i = 0; i < state.tags.length; i++) {
        var tag = state.tags[i];
        var aColor = areaColor(tag.area);
        var tColor = typeColor(tag.dataType);

        var card = document.createElement('div');
        card.className = 'dash-card';
        card.style.setProperty('--card-accent', aColor);
        card.style.setProperty('--type-bg', tColor);
        card.dataset.index = i;
        card.title = tag.name + ' · ' + tag.address + ' · ' + tag.dataType;

        card.innerHTML =
            '<div class="dash-top">' +
                '<div class="dash-name">' + esc(tag.name) + '</div>' +
                '<div class="dash-addr">' + esc(tag.address) + '</div>' +
            '</div>' +
            '<div class="dash-bottom">' +
                '<div class="dash-value" id="dashVal' + i + '">' + esc(formatValue(tag.value, tag.quality)) + '</div>' +
                '<div class="dash-type">' + esc(tag.dataType) + '</div>' +
            '</div>';

        state.dashValEls[i] = card.querySelector('.dash-value');
        state.dashValEls[i].title = formatValueFull(tag.value, tag.quality);

        (function (idx) {
            card.addEventListener('dblclick', function () { handleDoubleClick(idx); });
        })(i);

        container.appendChild(card);
    }
}

function updateDashboardValues() {
    for (var i = 0; i < state.tags.length; i++) {
        var tag = state.tags[i];
        var el = state.dashValEls[i];
        if (el) {
            var newVal = formatValue(tag.value, tag.quality);
            if (el.textContent !== newVal) {
                el.textContent = newVal;
                el.title = formatValueFull(tag.value, tag.quality);
                el.className = 'dash-value ' + (tag.quality === 'Good' ? '' : tag.quality === 'Bad' ? 'bad' : 'unknown');
                // 只让数值本身闪一下，整张卡片闪烁在 100ms 扫描下会非常干扰
                flashValue(el);
            }
        }
    }
}

// 数值变化时的短暂高亮（同一元素连续变化只保留一次动画）
function flashValue(el) {
    el.classList.remove('value-updated');
    void el.offsetWidth; // 强制重排，让动画可以重新触发
    el.classList.add('value-updated');
    if (el._flashTimer) clearTimeout(el._flashTimer);
    el._flashTimer = setTimeout(function () { el.classList.remove('value-updated'); }, 460);
}

// ── Tag Table ─────────────────────────────────────────────────

function renderTable() {
    var tbody = document.getElementById('tagTableBody');
    tbody.innerHTML = '';

    state.tblValEls = {};
    state.tblQBadges = {};
    state.tblTimeEls = {};
    updateGroupFilter();

    var visible = 0;
    for (var i = 0; i < state.tags.length; i++) {
        var tag = state.tags[i];
        if (!tagMatches(tag)) continue;
        visible++;

        var aColor = areaColor(tag.area);
        var tColor = typeColor(tag.dataType);
        var qualityClass = tag.quality === 'Good' ? 'good' : tag.quality === 'Bad' ? 'bad' : 'unknown';
        var valueClass = tag.quality === 'Good' ? '' : tag.quality === 'Bad' ? 'bad' : 'unknown';

        var tr = document.createElement('tr');
        tr.dataset.index = i;

        (function (idx, row) {
            row.addEventListener('contextmenu', function (e) { showContextMenu(e, idx); });
            row.addEventListener('dblclick', function () { handleDoubleClick(idx); });
        })(i, tr);

        tr.innerHTML =
            '<td>' +
                '<div class="cell-name">' +
                    '<span class="scan-dot ' + (tag.scanEnabled ? 'on' : 'off') + '"></span>' +
                    '<span class="area-dot" style="background:' + aColor + '"></span>' +
                    '<span class="name-text" title="' + esc(tag.name) + '">' + esc(tag.name) + '</span>' +
                '</div>' +
            '</td>' +
            '<td class="cell-address" title="' + esc(tag.address) + '">' + esc(tag.address) + '</td>' +
            '<td><span class="group-badge">' + esc(tag.group || 'Default') + '</span></td>' +
            '<td><span class="type-badge" style="background:' + hexToRgba(tColor, 0.15) + ';color:' + tColor + '">' + esc(tag.dataType) + '</span></td>' +
            '<td><span class="cell-value ' + valueClass + '">' + esc(formatValue(tag.value, tag.quality)) + '</span></td>' +
            '<td><span class="quality-badge ' + qualityClass + '">' + qualityLabel(tag.quality) + '</span></td>' +
            '<td class="cell-time">' + esc(tag.timestamp || '--') + '</td>';

        // Cache element refs for fast per-scan updates
        state.tblValEls[i] = tr.querySelector('.cell-value');
        state.tblValEls[i].title = formatValueFull(tag.value, tag.quality);
        state.tblQBadges[i] = tr.querySelector('.quality-badge');
        state.tblTimeEls[i] = tr.querySelector('.cell-time');

        tbody.appendChild(tr);
    }

    if (visible === 0) {
        var trEmpty = document.createElement('tr');
        trEmpty.innerHTML = '<td colspan="7" class="no-results">没有符合筛选条件的标签</td>';
        tbody.appendChild(trEmpty);
    }
}

function updateTableValues() {
    for (var i = 0; i < state.tags.length; i++) {
        var tag = state.tags[i];
        var valEl = state.tblValEls[i];
        if (valEl) {
            var newVal = formatValue(tag.value, tag.quality);
            if (valEl.textContent !== newVal) {
                valEl.textContent = newVal;
                valEl.title = formatValueFull(tag.value, tag.quality); // 列宽有限时用省略号截断，完整值放 tooltip
                valEl.className = 'cell-value ' + (tag.quality === 'Good' ? '' : tag.quality === 'Bad' ? 'bad' : 'unknown');
                flashValue(valEl);
            }
        }
        var qBadge = state.tblQBadges[i];
        if (qBadge) {
            var qc = tag.quality === 'Good' ? 'good' : tag.quality === 'Bad' ? 'bad' : 'unknown';
            qBadge.className = 'quality-badge ' + qc;
            qBadge.textContent = qualityLabel(tag.quality);
        }
        var timeCell = state.tblTimeEls[i];
        if (timeCell && tag.timestamp) {
            timeCell.textContent = tag.timestamp;
        }
    }
}

// ── Filtering / Search ────────────────────────────────────────

function applyFilter() {
    filter.search = (document.getElementById('filterSearch').value || '').toLowerCase().trim();
    filter.group = document.getElementById('filterGroup').value;
    renderTable();
}

function tagMatches(tag) {
    if (filter.group !== 'All' && (tag.group || 'Default') !== filter.group) return false;
    if (filter.search) {
        var hay = ((tag.name || '') + ' ' + (tag.address || '') + ' ' + (tag.group || '')).toLowerCase();
        if (hay.indexOf(filter.search) < 0) return false;
    }
    return true;
}

function updateGroupFilter() {
    var sel = document.getElementById('filterGroup');
    if (!sel) return;
    var current = sel.value;
    var groups = {};
    for (var i = 0; i < state.tags.length; i++) {
        groups[state.tags[i].group || 'Default'] = true;
    }
    var keys = Object.keys(groups).sort();
    var html = '<option value="All">全部分组</option>';
    var found = false;
    for (var k = 0; k < keys.length; k++) {
        var selAttr = keys[k] === current ? ' selected' : '';
        if (selAttr) found = true;
        html += '<option value="' + esc(keys[k]) + '"' + selAttr + '>' + esc(keys[k]) + '</option>';
    }
    sel.innerHTML = html;
    // If the previously-selected group no longer exists, fall back to All
    if (!found && current !== 'All') filter.group = 'All';
}

// ── Sidebar ───────────────────────────────────────────────────

function toggleSidebar() {
    var collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('scada-sidebar', collapsed ? 'collapsed' : 'expanded');
    var btn = document.getElementById('btnSidebar');
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

// ── Value Formatting ──────────────────────────────────────────

function formatValue(value, quality) {
    if (quality === 'Unknown' || value === null || value === undefined) return '---';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') {
        if (Number.isInteger(value)) return value.toString();
        return value.toFixed(4);
    }
    return String(value);
}

// 完整值（含十六进制注释），列宽有限时截断了才用 tooltip 展示
function formatValueFull(value, quality) {
    var base = formatValue(value, quality);
    if (typeof value === 'number' && Number.isInteger(value) && value > 0xFFFF) {
        return base + '  (0x' + value.toString(16).toUpperCase() + ')';
    }
    return base;
}

function qualityLabel(q) {
    if (q === 'Good') return '良好';
    if (q === 'Bad') return '异常';
    return '未知';
}

// ── Context Menu ──────────────────────────────────────────────

function showContextMenu(e, index) {
    e.preventDefault();
    state.contextTagIndex = index;

    var tag = state.tags[index];
    var menu = document.getElementById('contextMenu');
    var toggleText = document.getElementById('ctxToggleScanText');
    toggleText.textContent = tag.scanEnabled ? '停用扫描' : '启用扫描';

    var rows = document.querySelectorAll('.data-table tr.selected');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('selected');
    e.currentTarget.classList.add('selected');

    var x = e.clientX;
    var y = e.clientY;
    menu.classList.add('visible');

    var rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function hideContextMenu() {
    document.getElementById('contextMenu').classList.remove('visible');
    var rows = document.querySelectorAll('.data-table tr.selected');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('selected');
}

function contextWriteValue() {
    hideContextMenu();
    var idx = state.contextTagIndex;
    if (idx < 0 || idx >= state.tags.length) return;

    var tag = state.tags[idx];
    if (tag.dataType === 'Bool' && state.connected) {
        var currentVal = tag.value === true;
        writeValue(idx, !currentVal);
        return;
    }

    showWriteValueModal(idx);
}

function contextToggleScan() {
    hideContextMenu();
    var idx = state.contextTagIndex;
    if (idx >= 0) toggleScan(idx);
}

function contextEditTag() {
    hideContextMenu();
    var idx = state.contextTagIndex;
    if (idx >= 0 && idx < state.tags.length) {
        showEditTagModal(idx);
    }
}

function contextDeleteTag() {
    hideContextMenu();
    var idx = state.contextTagIndex;
    if (idx >= 0) {
        if (confirm('确定删除标签「' + state.tags[idx].name + '」？')) {
            deleteTag(idx);
        }
    }
}

// ── Double-click handler ──────────────────────────────────────

function handleDoubleClick(index) {
    state.contextTagIndex = index;
    contextWriteValue();
}

// ── Tag Editor Modal ──────────────────────────────────────────

// 内联错误提示（比只弹 toast 更靠近问题字段）
function setFieldError(inputId, errorId, message) {
    var input = document.getElementById(inputId);
    var err = document.getElementById(errorId);
    if (input) input.classList.add('invalid');
    if (err) {
        err.textContent = message || '';
        err.classList.toggle('visible', !!message);
    }
}

function clearFieldError(inputId, errorId) {
    var input = document.getElementById(inputId);
    var err = document.getElementById(errorId);
    if (input) input.classList.remove('invalid');
    if (err) {
        err.textContent = '';
        err.classList.remove('visible');
    }
}

function clearEditorErrors() {
    clearFieldError('editorName', 'editorNameError');
    clearFieldError('editorAddress', 'editorAddressError');
}

function showAddTagModal() {
    state.editingTagIndex = -1;
    state.editorTypeTouched = false; // 新增时允许按地址自动推断类型
    document.getElementById('tagEditorTitle').textContent = '添加标签';
    document.getElementById('editorName').value = '';
    document.getElementById('editorAddress').value = '';
    document.getElementById('editorDataType').value = 'Bool';
    document.getElementById('editorGroup').value = 'Default';
    document.getElementById('editorComment').value = '';
    document.getElementById('editorScanEnabled').checked = true;
    clearEditorErrors();
    var preview = document.getElementById('editorPreview');
    preview.textContent = '输入地址后自动解析…';
    preview.className = 'field-preview';
    document.getElementById('tagEditorModal').classList.add('visible');
    document.getElementById('editorName').focus();
}

function showEditTagModal(index) {
    var tag = state.tags[index];
    if (!tag) return;

    state.editingTagIndex = index;
    state.editorTypeTouched = true; // 编辑已有标签：保留原数据类型，不被地址后缀覆盖
    document.getElementById('tagEditorTitle').textContent = '编辑标签';
    document.getElementById('editorName').value = tag.name;
    document.getElementById('editorAddress').value = tag.address;
    document.getElementById('editorDataType').value = tag.dataType;
    document.getElementById('editorGroup').value = tag.group;
    document.getElementById('editorComment').value = tag.comment || '';
    document.getElementById('editorScanEnabled').checked = tag.scanEnabled;
    clearEditorErrors();
    onAddressChanged();
    document.getElementById('tagEditorModal').classList.add('visible');
}

function closeTagEditor() {
    document.getElementById('tagEditorModal').classList.remove('visible');
    clearEditorErrors();
}

function confirmTagEditor() {
    var name = document.getElementById('editorName').value.trim();
    var address = document.getElementById('editorAddress').value.trim().toUpperCase();
    var dataType = document.getElementById('editorDataType').value;
    var group = document.getElementById('editorGroup').value.trim() || 'Default';
    var comment = document.getElementById('editorComment').value.trim();
    var scanEnabled = document.getElementById('editorScanEnabled').checked;

    clearEditorErrors();

    if (!name) {
        setFieldError('editorName', 'editorNameError', '请填写标签名称');
        document.getElementById('editorName').focus();
        return;
    }
    if (!address) {
        setFieldError('editorAddress', 'editorAddressError', '请填写地址');
        document.getElementById('editorAddress').focus();
        return;
    }
    if (!parseAddress(address)) {
        setFieldError('editorAddress', 'editorAddressError', '地址无法解析，请检查格式（如 DB1.DBW2 / M0.0）');
        document.getElementById('editorAddress').focus();
        return;
    }

    var tag = {
        name: name,
        address: address,
        dataType: dataType,
        group: group,
        comment: comment,
        scanEnabled: scanEnabled
    };

    if (state.editingTagIndex >= 0) {
        editTag(state.editingTagIndex, tag);
    } else {
        addTag(tag);
    }

    closeTagEditor();
}

// Address auto-parse preview
function onAddressChanged() {
    var addr = document.getElementById('editorAddress').value.trim().toUpperCase();
    var preview = document.getElementById('editorPreview');
    clearFieldError('editorAddress', 'editorAddressError');

    if (!addr) {
        preview.textContent = '输入地址后自动解析…';
        preview.className = 'field-preview';
        return;
    }

    var parsed = parseAddress(addr);
    if (parsed) {
        var text;
        if (parsed.modbus) {
            text = '区域: ' + areaLabel(parsed.area) + '   |   类型: ' + parsed.dataType + '   |   寄存器地址: ' + parsed.byteOffset;
        } else {
            text = '区域: ' + parsed.area + '   |   类型: ' + parsed.dataType + '   |   字节偏移: ' + parsed.byteOffset;
            if (parsed.dataType === 'Bool') text += '   |   位: ' + parsed.bitOffset;
        }
        preview.textContent = text;
        preview.className = 'field-preview valid';
        // 仅当用户没有手动选过类型时才用地址后缀联动下拉
        if (!state.editorTypeTouched) {
            document.getElementById('editorDataType').value = parsed.dataType;
        }
    } else {
        preview.textContent = '无法解析该地址，请检查格式';
        preview.className = 'field-preview invalid';
        document.getElementById('editorAddress').classList.add('invalid');
    }
}

// 按当前协议选择解析器
function parseAddress(addr) {
    return currentProtocol() === 'ModbusTcp' ? parseModbusAddress(addr) : parseS7Address(addr);
}

// Modbus 地址解析（镜像 ModbusAddressParser.cs）
// 支持 HR/IR/CO/DI + 0 基址，以及 Modicon 1 基址编号 4xxxx/3xxxx/1xxxx/0xxxx
function parseModbusAddress(addr) {
    if (!addr) return null;

    var prefixed = addr.match(/^(HR|IR|CO|DI)(\d+)$/);
    if (prefixed) {
        var area = prefixed[1];
        var offset = parseInt(prefixed[2]);
        if (offset > 65535) return null;
        return makeModbusResult(area, offset);
    }

    var modicon = addr.match(/^([0134])(\d{4,5})$/);
    if (modicon) {
        var first = modicon[1];
        var area2 = first === '0' ? 'CO' : first === '1' ? 'DI' : first === '3' ? 'IR' : 'HR';
        var oneBased = parseInt(modicon[2]);
        if (oneBased <= 0) return null;
        return makeModbusResult(area2, oneBased - 1);
    }

    return null;
}

function makeModbusResult(area, offset) {
    return {
        area: area,
        dataType: (area === 'CO' || area === 'DI') ? 'Bool' : 'Word',
        dbNumber: 0,
        byteOffset: offset,
        bitOffset: 0,
        modbus: true
    };
}

// S7 地址解析（镜像 AddressParser.cs）
function parseS7Address(addr) {
    if (!addr) return null;

    // DB: DB1.DBX0.0, DB1.DBW2, DB1.DBD4, DB1.DBB0
    var dbMatch = addr.match(/^DB(\d+)\.(DB[WXDB])(\d+)(?:\.(\d+))?$/i);
    if (dbMatch) {
        var dbNum = parseInt(dbMatch[1]);
        var suffix = dbMatch[2].toUpperCase();
        var offset = parseInt(dbMatch[3]);
        var bitPart = dbMatch[4] !== undefined ? parseInt(dbMatch[4]) : 0;
        var typeChar = suffix[2];

        var typeMap = { X: 'Bool', B: 'Byte', W: 'Word', D: 'DWord' };
        return {
            area: 'DB',
            dataType: typeMap[typeChar] || 'Word',
            dbNumber: dbNum,
            byteOffset: offset,
            bitOffset: bitPart
        };
    }

    // Non-DB: M0.0, MW2, I0.0, Q0.0, T0, C0
    var nonDb = addr.match(/^([MIQTC])([WXDB])?(\d+)(?:\.(\d+))?$/i);
    if (nonDb) {
        var areaPrefix = nonDb[1].toUpperCase();
        var tc = nonDb[2] ? nonDb[2].toUpperCase() : null;
        var off = parseInt(nonDb[3]);
        var bp = nonDb[4] !== undefined ? parseInt(nonDb[4]) : null;

        if (!tc && bp !== null) {
            return { area: areaPrefix, dataType: 'Bool', dbNumber: 0, byteOffset: off, bitOffset: bp };
        }
        if (!tc && bp === null) {
            return { area: areaPrefix, dataType: 'Word', dbNumber: 0, byteOffset: off, bitOffset: 0 };
        }
        var tm = { X: 'Bool', B: 'Byte', W: 'Word', D: 'DWord' };
        return {
            area: areaPrefix,
            dataType: tm[tc] || 'Word',
            dbNumber: 0,
            byteOffset: off,
            bitOffset: bp || 0
        };
    }

    return null;
}

// ── Write Value Modal ─────────────────────────────────────────

var writeTargetIndex = -1;

function showWriteValueModal(index) {
    var tag = state.tags[index];
    if (!tag) return;

    if (!state.connected) {
        showToast('PLC 未连接，无法写入。请先连接。', 'error');
        return;
    }

    writeTargetIndex = index;
    document.getElementById('writeTagName').textContent = tag.name;
    document.getElementById('writeTagAddr').textContent = tag.address + '   ·   ' + tag.dataType;
    document.getElementById('writeTagCurrent').textContent = '当前值: ' + formatValue(tag.value, tag.quality);
    clearFieldError('writeValueInput', 'writeValueError');

    var input = document.getElementById('writeValueInput');
    input.value = '';
    input.placeholder = writePlaceholder(tag.dataType);
    document.getElementById('writeValueModal').classList.add('visible');
    input.focus();
}

// 按数据类型给出输入提示与取值范围
function writePlaceholder(dataType) {
    switch (dataType) {
        case 'Bool':  return 'true / false（或 1 / 0）';
        case 'Byte':  return '0 ~ 255，支持 0x1F';
        case 'Word':  return '0 ~ 65535，支持 0xFFFF';
        case 'DWord': return '0 ~ 4294967295，支持 0xFFFFFFFF';
        case 'Int':   return '-32768 ~ 32767';
        case 'DInt':  return '-2147483648 ~ 2147483647';
        case 'Real':  return '浮点数，如 12.5';
        default:      return '输入数值';
    }
}

function closeWriteValue() {
    document.getElementById('writeValueModal').classList.remove('visible');
    clearFieldError('writeValueInput', 'writeValueError');
    writeTargetIndex = -1;
}

// ── About ─────────────────────────────────────────────────────
function openAbout() {
    document.getElementById('aboutModal').classList.add('visible');
}
function closeAbout() {
    document.getElementById('aboutModal').classList.remove('visible');
}

function confirmWriteValue() {
    var input = document.getElementById('writeValueInput').value.trim();
    clearFieldError('writeValueInput', 'writeValueError');

    function fail(msg) {
        setFieldError('writeValueInput', 'writeValueError', msg);
        document.getElementById('writeValueInput').focus();
    }

    if (!input) {
        fail('请输入要写入的值');
        return;
    }
    if (writeTargetIndex < 0 || writeTargetIndex >= state.tags.length) return;

    var tag = state.tags[writeTargetIndex];
    var value;

    try {
        if (tag.dataType === 'Bool') {
            var t = input.toLowerCase();
            if (!/^(true|false|1|0|on|off)$/.test(t)) {
                fail('Bool 只接受 true / false（或 1 / 0）');
                return;
            }
            value = (t === 'true' || t === '1' || t === 'on');
        } else if (tag.dataType === 'Real') {
            value = parseFloat(input);
            if (isNaN(value)) {
                fail('请输入有效的浮点数');
                return;
            }
        } else {
            var isHex = /^0x/i.test(input);
            value = isHex ? parseInt(input.slice(2), 16) : parseInt(input, 10);
            if (isNaN(value)) {
                fail(isHex ? '十六进制格式不正确，例如 0x1F' : '请输入整数');
                return;
            }
            // DWord 是无符号 32 位：>2^31 时 parseInt 会得到负值，需要转回无符号
            if (tag.dataType === 'DWord') value = value >>> 0;
        }
    } catch (ex) {
        fail('无法解析该数值');
        return;
    }

    // 范围校验（超出 PLC 侧数据类型宽度会被截断，提前拦下来）
    var rangeMsg = checkValueRange(tag.dataType, value);
    if (rangeMsg) {
        fail(rangeMsg);
        return;
    }

    writeValue(writeTargetIndex, value);
    closeWriteValue();
}

function checkValueRange(dataType, value) {
    switch (dataType) {
        case 'Byte':  return (value < 0 || value > 255) ? 'Byte 取值范围 0 ~ 255' : '';
        case 'Word':  return (value < 0 || value > 65535) ? 'Word 取值范围 0 ~ 65535' : '';
        case 'DWord': return (value < 0 || value > 4294967295) ? 'DWord 取值范围 0 ~ 4294967295' : '';
        case 'Int':   return (value < -32768 || value > 32767) ? 'Int 取值范围 -32768 ~ 32767' : '';
        case 'DInt':  return (value < -2147483648 || value > 2147483647) ? 'DInt 取值范围 -2147483648 ~ 2147483647' : '';
        default:      return '';
    }
}

// ── Window Drag ───────────────────────────────────────────────
// 原生标题栏负责拖动窗口，无需自定义处理。

// ── DOM Ready Bindings ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btnTheme').addEventListener('click', toggleTheme);

    var btnSidebar = document.getElementById('btnSidebar');
    if (btnSidebar) btnSidebar.addEventListener('click', toggleSidebar);

    // 协议相关 UI 初始化（默认 S7），并通知 C# 侧当前协议
    onProtocolChanged();

    // 标签编辑弹窗：手动选择类型后不再被地址后缀覆盖；输入时即时清除错误
    var editorType = document.getElementById('editorDataType');
    if (editorType) editorType.addEventListener('change', function () { state.editorTypeTouched = true; });
    var editorName = document.getElementById('editorName');
    if (editorName) editorName.addEventListener('input', function () { clearFieldError('editorName', 'editorNameError'); });

    // 连接中修改扫描周期：立即下发，无需重连
    var scanInput = document.getElementById('inputScan');
    if (scanInput) {
        scanInput.addEventListener('change', function () {
            var ms = parseInt(this.value) || 100;
            if (ms < 50) ms = 50;
            if (ms > 10000) ms = 10000;
            this.value = ms;
            if (state.connected) {
                postToCSharp({ action: 'setScanInterval', ms: ms });
                showToast('扫描周期已更新为 ' + ms + ' ms', 'success');
            }
        });
    }

    // Info-card accordions (click header to collapse/expand)
    var heads = document.querySelectorAll('.info-card-head');
    for (var i = 0; i < heads.length; i++) {
        heads[i].addEventListener('click', function () {
            this.parentElement.classList.toggle('collapsed');
        });
        heads[i].addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.parentElement.classList.toggle('collapsed');
            }
        });
    }

    // Group filter + search
    var groupSel = document.getElementById('filterGroup');
    if (groupSel) groupSel.addEventListener('change', applyFilter);
    var searchEl = document.getElementById('filterSearch');
    if (searchEl) searchEl.addEventListener('input', applyFilter);

    // Restore sidebar collapsed state
    if (localStorage.getItem('scada-sidebar') === 'collapsed') {
        document.body.classList.add('sidebar-collapsed');
        if (btnSidebar) btnSidebar.setAttribute('aria-expanded', 'false');
    }
});

// ── Keyboard Shortcuts ────────────────────────────────────────

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        hideContextMenu();
        if (document.getElementById('tagEditorModal').classList.contains('visible')) {
            closeTagEditor();
        }
        if (document.getElementById('writeValueModal').classList.contains('visible')) {
            closeWriteValue();
        }
        if (document.getElementById('aboutModal').classList.contains('visible')) {
            closeAbout();
        }
    }

    if (e.key === 'Enter') {
        if (document.getElementById('tagEditorModal').classList.contains('visible')) {
            confirmTagEditor();
            e.preventDefault();
        }
        if (document.getElementById('writeValueModal').classList.contains('visible')) {
            confirmWriteValue();
            e.preventDefault();
        }
    }

    // 大小写无关（CapsLock / Shift 下同样生效）
    var key = (e.key || '').toLowerCase();

    if (key === 'f5') { connectPlc(); e.preventDefault(); }
    if (key === 'f6') { disconnectPlc(); e.preventDefault(); }

    if (e.ctrlKey && key === 'n') { showAddTagModal(); e.preventDefault(); }
    if (e.ctrlKey && key === 's') { saveConfig(); e.preventDefault(); }
    if (e.ctrlKey && key === 'b') { toggleSidebar(); e.preventDefault(); }
});

// ── Click Outside Handlers ────────────────────────────────────

document.addEventListener('click', function (e) {
    var menu = document.getElementById('contextMenu');
    if (menu.classList.contains('visible') && !menu.contains(e.target)) {
        hideContextMenu();
    }
});

document.getElementById('tagEditorModal').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeTagEditor();
});
document.getElementById('writeValueModal').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeWriteValue();
});
document.getElementById('aboutModal').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeAbout();
});

// ══ 画面编辑器 ══════════════════════════════════════════════

window.onScreensChanged = function (screens) {
    state.screens = (screens && Array.isArray(screens)) ? screens : [];
    state.currentScreen = state.screens.length > 0 ? 0 : -1;
    state.selectedWidgets = [];
    undoStack.length = 0;
    redoStack.length = 0;
    renderScreens();
};

// ── 视图切换 ────────────────────────────────────────────────
function switchView(view) {
    state.view = view;
    document.getElementById('tableView').style.display = view === 'table' ? '' : 'none';
    document.getElementById('screensView').style.display = view === 'screens' ? 'flex' : 'none';
    document.getElementById('btnViewTable').classList.toggle('active', view === 'table');
    document.getElementById('btnViewScreens').classList.toggle('active', view === 'screens');
    // 切到画面视图时立即刷新一次组件值，避免显示上一次扫描的旧值
    if (view === 'screens') updateScreenWidgets();
}

// ── 画面 CRUD ────────────────────────────────────────────────
function renderScreens() {
    var tabs = document.getElementById('screenTabs');
    tabs.innerHTML = '';
    for (var i = 0; i < state.screens.length; i++) {
        (function (idx) {
            var tab = document.createElement('div');
            tab.className = 'screen-tab' + (idx === state.currentScreen ? ' active' : '');
            tab.textContent = state.screens[idx].name;
            tab.title = '单击切换 · 双击重命名';
            tab.addEventListener('click', function () { selectScreen(idx); });
            tab.addEventListener('dblclick', function () {
                selectScreen(idx);
                beginRenameScreen(idx);
            });
            tabs.appendChild(tab);
        })(i);
    }
    renderCanvas();
    renderProps();
}

function selectScreen(i) {
    if (i < 0 || i >= state.screens.length) return;
    state.currentScreen = i;
    state.selectedWidgets = [];
    renderScreens();
}

function addScreen() {
    var n = state.screens.length + 1;
    var name = '画面' + n;
    while (state.screens.some(function (s) { return s.name === name; })) n++;
    pushUndo();
    state.screens.push({ name: name, widgets: [] });
    state.currentScreen = state.screens.length - 1;
    state.selectedWidgets = [];
    renderScreens();
    scheduleSaveScreens();
}

// 就地重命名画面 tab（Enter 确认 / Esc 取消 / 失焦确认），比原生 prompt 更贴近桌面应用
function beginRenameScreen(idx) {
    var screen = state.screens[idx];
    var tab = document.querySelectorAll('#screenTabs .screen-tab')[idx];
    if (!screen || !tab) return;

    tab.setAttribute('contenteditable', 'true');
    tab.classList.add('editing');
    tab.focus();

    var range = document.createRange();
    range.selectNodeContents(tab);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    var done = false;
    function commit(save) {
        if (done) return;
        done = true;
        tab.removeAttribute('contenteditable');
        tab.classList.remove('editing');
        var name = (tab.textContent || '').replace(/\s+/g, ' ').trim();
        if (save && name && name !== screen.name) {
            pushUndo();
            screen.name = name;
            scheduleSaveScreens();
        }
        renderScreens();
    }

    tab.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        e.stopPropagation(); // 不触发全局快捷键
    });
    tab.addEventListener('blur', function () { commit(true); });
}

function renameCurrentScreen() {
    beginRenameScreen(state.currentScreen);
}

function deleteCurrentScreen() {
    if (state.screens.length === 0) return;
    var screen = state.screens[state.currentScreen];
    if (!screen || !confirm('确定删除画面「' + screen.name + '」？')) return;
    pushUndo();
    state.screens.splice(state.currentScreen, 1);
    if (state.currentScreen >= state.screens.length) state.currentScreen = state.screens.length - 1;
    state.selectedWidgets = [];
    renderScreens();
    scheduleSaveScreens();
}

// ── 组件 CRUD ────────────────────────────────────────────────
// 组件类型：value 数值 / lamp 指示灯 / text 文本 / bar 棒图 / button 按钮 / rect 矩形
// 新增字段均为可选，旧 screens.json（仅含 id/type/label/tag/x/y/w/h/font）可继续正常工作
function defaultWidget(type, id) {
    var base = { id: id, type: type, label: '', tag: '', x: 40, y: 40, w: 160, h: 48, font: 14 };
    if (type === 'value') {
        base.x = 120; base.y = 80; base.w = 180; base.h = 64; base.font = 20;
    } else if (type === 'lamp') {
        base.x = 400; base.y = 80; base.w = 64; base.h = 64; base.font = 11;
    } else if (type === 'text') {
        base.x = 40; base.y = 20; base.w = 160; base.h = 30; base.font = 16; base.label = '文本';
    } else if (type === 'bar') {
        base.x = 120; base.y = 200; base.w = 220; base.h = 28; base.font = 12;
        base.min = 0; base.max = 100; base.barColor = '#2f6ee0';
    } else if (type === 'button') {
        base.x = 400; base.y = 200; base.w = 120; base.h = 40; base.font = 14;
        base.label = '按钮'; base.action = 'toggle'; base.btnColor = '#2f6ee0';
    } else if (type === 'rect') {
        base.x = 40; base.y = 120; base.w = 200; base.h = 120;
        base.bg = '#dfe6f2'; base.border = true; base.radius = 8;
    }
    return base;
}

// 组件类型中文名
function widgetTypeLabel(type) {
    if (type === 'value') return '数值';
    if (type === 'lamp') return '指示灯';
    if (type === 'text') return '文本';
    if (type === 'bar') return '棒图';
    if (type === 'button') return '按钮';
    if (type === 'rect') return '矩形';
    return '组件';
}

// 唯一 id（时间戳 + 随机后缀，避免同一毫秒内重复）
function newWidgetId() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getWidget(id) {
    var screen = state.screens[state.currentScreen];
    if (!screen) return null;
    for (var i = 0; i < screen.widgets.length; i++) {
        if (screen.widgets[i].id === id) return screen.widgets[i];
    }
    return null;
}

// 深拷贝一个组件对象
function cloneWidget(w) {
    var c = {};
    for (var k in w) {
        if (Object.prototype.hasOwnProperty.call(w, k)) c[k] = w[k];
    }
    return c;
}

// ── 选择（支持多选） ─────────────────────────────────────────
function getSelectedWidgets() {
    var screen = state.screens[state.currentScreen];
    if (!screen) return [];
    var out = [];
    for (var i = 0; i < screen.widgets.length; i++) {
        if (state.selectedWidgets.indexOf(screen.widgets[i].id) >= 0) out.push(screen.widgets[i]);
    }
    return out;
}

function setSelection(ids) {
    state.selectedWidgets = ids || [];
    applySelectionClass();
    renderProps();
}

function applySelectionClass() {
    var widgets = document.querySelectorAll('#screenCanvas .widget');
    for (var i = 0; i < widgets.length; i++) {
        widgets[i].classList.toggle('selected', state.selectedWidgets.indexOf(widgets[i].dataset.id) >= 0);
    }
}

// additive=true 时加选 / 减选（Ctrl、Shift 或 Cmd 点击）
function selectWidget(id, additive) {
    if (!id) { setSelection([]); return; }
    if (additive) {
        var next = state.selectedWidgets.slice();
        var idx = next.indexOf(id);
        if (idx >= 0) next.splice(idx, 1); else next.push(id);
        setSelection(next);
    } else {
        setSelection([id]);
    }
}

function addWidget(type) {
    var screen = state.screens[state.currentScreen];
    if (!screen) { showToast('请先新建一个画面', 'error'); return; }
    pushUndo();
    var w = defaultWidget(type, newWidgetId());
    screen.widgets.push(w);
    state.selectedWidgets = [w.id];
    renderScreens();
    scheduleSaveScreens();
}

function deleteSelectedWidget() {
    if (state.selectedWidgets.length === 0) return;
    var screen = state.screens[state.currentScreen];
    if (!screen) return;
    pushUndo();
    screen.widgets = screen.widgets.filter(function (w) {
        return state.selectedWidgets.indexOf(w.id) < 0;
    });
    state.selectedWidgets = [];
    renderScreens();
    scheduleSaveScreens();
}

// ── 画布渲染 ─────────────────────────────────────────────────
function renderCanvas() {
    var canvas = document.getElementById('screenCanvas');
    var empty = document.getElementById('screenEmpty');
    canvas.innerHTML = '';
    empty.style.display = state.screens.length === 0 ? '' : 'none';
    var screen = state.screens[state.currentScreen];
    if (!screen) return;
    for (var i = 0; i < screen.widgets.length; i++) {
        canvas.appendChild(renderWidget(screen.widgets[i]));
    }
}

function renderWidget(w) {
    var el = document.createElement('div');
    el.className = 'widget widget-' + w.type + (state.selectedWidgets.indexOf(w.id) >= 0 ? ' selected' : '');
    el.dataset.id = w.id;
    el.style.left = (w.x || 0) + 'px';
    el.style.top = (w.y || 0) + 'px';
    el.style.width = (w.w || 100) + 'px';
    el.style.height = (w.h || 40) + 'px';

    var handle = '<div class="widget-resize-handle"></div>';
    if (w.type === 'value') {
        el.innerHTML = '<div class="widget-label"></div><div class="widget-value-text"></div>' + handle;
    } else if (w.type === 'lamp') {
        el.innerHTML = '<div class="widget-lamp-circle"></div><div class="widget-lamp-label"></div>' + handle;
    } else if (w.type === 'text') {
        el.innerHTML = '<div class="widget-text-content"></div>' + handle;
    } else if (w.type === 'bar') {
        el.innerHTML = '<div class="widget-bar-track"><div class="widget-bar-fill"></div></div><div class="widget-bar-label"></div>' + handle;
    } else if (w.type === 'button') {
        el.innerHTML = '<button type="button" class="widget-button" tabindex="-1"></button>' + handle;
    } else if (w.type === 'rect') {
        el.innerHTML = handle;
    }
    updateWidgetDom(w, el);
    return el;
}

// ── 组件实时数据/样式刷新 ────────────────────────────────────
function findTagIndex(name) {
    for (var i = 0; i < state.tags.length; i++) {
        if (state.tags[i].name === name) return i;
    }
    return -1;
}

function updateWidgetDom(w, el) {
    if (!el) return;

    var tagIdx = findTagIndex(w.tag);
    var tag = tagIdx >= 0 ? state.tags[tagIdx] : null;
    var quality = tag ? tag.quality : 'Unknown';
    var hasValue = !!tag && quality === 'Good' && tag.value !== null && tag.value !== undefined;

    // 通用样式（背景 / 边框 / 圆角 / 对齐 / 文字色 / 加粗）
    applyWidgetStyle(w, el);

    if (w.type === 'value') {
        var labelEl = el.querySelector('.widget-label');
        if (labelEl) labelEl.textContent = w.label || (tag ? tag.name : '未绑定');
        var valEl = el.querySelector('.widget-value-text');
        if (valEl) {
            valEl.textContent = formatWidgetValue(w, tag ? tag.value : null, quality);
            valEl.className = 'widget-value-text ' +
                (quality === 'Bad' ? 'bad' : quality === 'Unknown' ? 'unknown' : '');
            valEl.style.fontSize = (w.font || 20) + 'px';
        }
    } else if (w.type === 'lamp') {
        var circ = el.querySelector('.widget-lamp-circle');
        if (circ) {
            circ.className = 'widget-lamp-circle';
            circ.style.background = '';
            circ.style.boxShadow = '';
            if (hasValue && typeof tag.value === 'boolean') {
                circ.classList.add(tag.value ? 'on' : 'off');
                if (w.onColor) {
                    circ.style.background = tag.value ? w.onColor : '';
                    circ.style.boxShadow = tag.value ? ('0 0 0 6px ' + hexToRgba(w.onColor, 0.18)) : '';
                }
            }
        }
        var lbl = el.querySelector('.widget-lamp-label');
        if (lbl) {
            var lampText = w.label || (tag ? tag.name : '未绑定');
            if (hasValue && typeof tag.value === 'boolean') {
                lampText = tag.value ? (w.boolTrue || lampText) : (w.boolFalse || lampText);
            }
            lbl.textContent = lampText;
            lbl.style.fontSize = (w.font || 11) + 'px';
        }
    } else if (w.type === 'text') {
        var tc = el.querySelector('.widget-text-content');
        if (tc) {
            tc.textContent = w.label || '';
            tc.style.fontSize = (w.font || 16) + 'px';
        }
    } else if (w.type === 'bar') {
        var fill = el.querySelector('.widget-bar-fill');
        var barLabel = el.querySelector('.widget-bar-label');
        var min = (w.min === '' || w.min === null || w.min === undefined) ? 0 : Number(w.min);
        var max = (w.max === '' || w.max === null || w.max === undefined) ? 100 : Number(w.max);
        var pct = 0;
        if (hasValue && typeof tag.value === 'number') {
            var span = (max - min) || 1;
            pct = Math.max(0, Math.min(100, (tag.value - min) / span * 100));
        }
        if (fill) {
            fill.style.width = pct.toFixed(1) + '%';
            fill.style.background = w.barColor || '';
        }
        if (barLabel) {
            barLabel.textContent = formatWidgetValue(w, tag ? tag.value : null, quality);
            barLabel.style.fontSize = (w.font || 12) + 'px';
        }
    } else if (w.type === 'button') {
        var btn = el.querySelector('.widget-button');
        if (btn) {
            btn.textContent = w.label || (tag ? tag.name : '按钮');
            btn.style.fontSize = (w.font || 14) + 'px';
            btn.style.background = w.btnColor || '';
        }
        el.classList.toggle('widget-button-on', hasValue && (tag.value === true || tag.value === 1));
    }
}

// 组件数值格式化（支持小数位与单位后缀）
function formatWidgetValue(w, value, quality) {
    if (quality === 'Unknown' || value === null || value === undefined) return '---';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') {
        var d = (w.decimals === '' || w.decimals === null || w.decimals === undefined) ? null : Number(w.decimals);
        var text = d === null ? formatValue(value, quality) : value.toFixed(d);
        if (w.unit) text += ' ' + w.unit;
        return text;
    }
    return String(value);
}

// 通用样式（背景 / 边框 / 圆角 / 对齐 / 文字色 / 加粗）
function applyWidgetStyle(w, el) {
    el.style.background = w.bg ? w.bg : '';
    if (w.border === true) el.style.border = '1px solid ' + (w.borderColor || 'var(--border-strong)');
    else if (w.border === false) el.style.border = 'none';
    else el.style.border = '';
    el.style.borderRadius = (w.radius === '' || w.radius === null || w.radius === undefined) ? '' : (Number(w.radius) + 'px');
    // 对齐：纵向布局组件（数值 / 指示灯）用 align-items，横向布局（文本）用 justify-content
    var alignVal = w.align === 'left' ? 'flex-start' : w.align === 'right' ? 'flex-end' : (w.align === 'center' ? 'center' : '');
    el.style.justifyContent = (w.type === 'text' && alignVal) ? alignVal : '';
    el.style.alignItems = ((w.type === 'value' || w.type === 'lamp') && alignVal) ? alignVal : '';

    var inner = el.querySelectorAll('.widget-label, .widget-value-text, .widget-lamp-label, .widget-text-content, .widget-bar-label, .widget-button');
    for (var i = 0; i < inner.length; i++) {
        inner[i].style.color = w.color ? w.color : '';
        inner[i].style.fontWeight = w.bold ? '700' : '';
    }
}

function updateScreenWidgets() {
    var screen = state.screens[state.currentScreen];
    if (!screen || state.view !== 'screens') return;
    var canvas = document.getElementById('screenCanvas');
    for (var i = 0; i < screen.widgets.length; i++) {
        var el = canvas.querySelector('.widget[data-id="' + screen.widgets[i].id + '"]');
        if (el) updateWidgetDom(screen.widgets[i], el);
    }
}

// ── 属性栏（按组件类型动态渲染） ─────────────────────────────

// 多选时：属性取值一致返回该值，否则返回 null（表示"多个值"）
function commonValue(list, key) {
    if (list.length === 0) return null;
    for (var i = 1; i < list.length; i++) {
        if (list[i][key] !== list[0][key]) return null;
    }
    return list[0][key];
}

function propField(label, inner, small) {
    return '<div class="prop-field' + (small ? ' prop-field-sm' : '') + '">' +
        '<label class="field-label">' + esc(label) + '</label>' + inner + '</div>';
}
function propNum(key, label, val, min, max, ph) {
    return propField(label, '<input type="number" class="field-input" data-prop="' + key + '"' +
        (min === null ? '' : ' min="' + min + '"') +
        (max === null ? '' : ' max="' + max + '"') +
        ' placeholder="' + esc(ph || '') + '"' +
        ' value="' + esc(val === null || val === undefined ? '' : String(val)) + '">', true);
}
function propText(key, label, val, ph) {
    return propField(label, '<input type="text" class="field-input" data-prop="' + key + '"' +
        ' value="' + esc(val === null || val === undefined ? '' : val) + '"' +
        ' placeholder="' + esc(ph || '') + '" spellcheck="false" autocomplete="off">');
}
function propColor(key, label, val) {
    return propField(label, '<span class="prop-color-wrap">' +
        '<input type="color" class="field-input prop-color" data-prop="' + key + '" value="' + esc(val || '#000000') + '">' +
        '<button type="button" class="prop-clear" data-clear="' + key + '" title="恢复默认">×</button>' +
        '</span>', true);
}
function propCheck(key, label, val) {
    return propField(label, '<label class="check-label">' +
        '<input type="checkbox" data-prop="' + key + '"' + (val ? ' checked' : '') + '>' +
        '<span class="check-box"></span></label>', true);
}
function propSelect(key, label, val, options) {
    var html = '<select class="field-input" data-prop="' + key + '">';
    for (var i = 0; i < options.length; i++) {
        html += '<option value="' + options[i].v + '"' + (String(val) === options[i].v ? ' selected' : '') + '>' +
            esc(options[i].t) + '</option>';
    }
    return propField(label, html + '</select>');
}
function alignOptions() {
    return [{ v: '', t: '默认' }, { v: 'left', t: '左' }, { v: 'center', t: '居中' }, { v: 'right', t: '右' }];
}
function tagOptions(current) {
    var html = '<option value=""' + (current ? '' : ' selected') + '>未绑定</option>';
    for (var i = 0; i < state.tags.length; i++) {
        var name = state.tags[i].name;
        html += '<option value="' + esc(name) + '"' + (name === current ? ' selected' : '') + '>' + esc(name) + '</option>';
    }
    return html;
}

// 对齐 / 层级按钮的可用状态（需选中 2 个以上组件才能对齐）
function updateEditButtons(count) {
    var alignBtns = document.querySelectorAll('#screenToolbar [data-align]');
    for (var i = 0; i < alignBtns.length; i++) alignBtns[i].disabled = count < 2;
    var zBtns = document.querySelectorAll('#screenToolbar [data-z]');
    for (var j = 0; j < zBtns.length; j++) zBtns[j].disabled = count === 0;
}

function renderProps() {
    var el = document.getElementById('widgetProps');
    var btnDel = document.getElementById('btnDeleteWidget');
    var sel = getSelectedWidgets();

    updateEditButtons(sel.length);

    // 没有选中时也保持属性栏占位（显示提示文字），避免画布高度变化
    if (sel.length === 0) {
        el.innerHTML = '<span class="widget-props-hint">选中组件后，在此编辑它的属性</span>';
        if (btnDel) btnDel.disabled = true;
        return;
    }
    if (btnDel) btnDel.disabled = false;

    var html = '';

    // 多选：只提供可批量应用的通用样式
    if (sel.length > 1) {
        var cAlign = commonValue(sel, 'align');
        html += '<span class="widget-props-title">已选 ' + sel.length + ' 个组件</span>';
        html += propColor('color', '文字色', commonValue(sel, 'color'));
        html += propColor('bg', '背景色', commonValue(sel, 'bg'));
        html += propNum('font', '字号', commonValue(sel, 'font'), 8, 96, '');
        html += propSelect('align', '对齐', cAlign === null ? '' : cAlign, alignOptions());
        html += propCheck('bold', '加粗', commonValue(sel, 'bold') === true);
        el.innerHTML = html;
        bindProps(el);
        return;
    }

    var w = sel[0];
    html += '<span class="widget-props-title">' + widgetTypeLabel(w.type) + '</span>';
    html += propNum('x', 'X', w.x, 0, null, '');
    html += propNum('y', 'Y', w.y, 0, null, '');
    html += propNum('w', '宽', w.w, 20, null, '');
    html += propNum('h', '高', w.h, 20, null, '');
    html += propNum('font', '字号', w.font, 8, 96, '');
    html += propColor('color', '文字色', w.color);
    html += propColor('bg', '背景色', w.bg);
    html += propSelect('align', '对齐', w.align || '', alignOptions());
    html += propCheck('bold', '加粗', w.bold === true);
    html += propCheck('border', '边框', w.border === true);

    // 按类型显示相关字段，隐藏无关项
    if (w.type === 'value' || w.type === 'lamp' || w.type === 'bar' || w.type === 'button') {
        html += propField('绑定标签', '<select class="field-input" data-prop="tag">' + tagOptions(w.tag) + '</select>');
    }
    if (w.type === 'value') {
        html += propText('label', '显示文字', w.label, '留空则显示标签名');
        html += propText('unit', '单位', w.unit, '如 ℃ / rpm');
        html += propNum('decimals', '小数位', w.decimals, 0, 6, '');
    } else if (w.type === 'lamp') {
        html += propText('label', '显示文字', w.label, '留空则显示标签名');
        html += propText('boolTrue', 'ON 文字', w.boolTrue, '留空用显示文字');
        html += propText('boolFalse', 'OFF 文字', w.boolFalse, '留空用显示文字');
        html += propColor('onColor', 'ON 颜色', w.onColor);
    } else if (w.type === 'text') {
        html += propText('label', '内容', w.label, '输入文本内容');
    } else if (w.type === 'bar') {
        html += propText('label', '标签', w.label, '可留空');
        html += propNum('min', '最小值', w.min, null, null, '0');
        html += propNum('max', '最大值', w.max, null, null, '100');
        html += propNum('decimals', '小数位', w.decimals, 0, 6, '');
        html += propColor('barColor', '填充色', w.barColor);
    } else if (w.type === 'button') {
        html += propText('label', '按钮文字', w.label, '留空则显示标签名');
        html += propSelect('action', '动作', w.action || 'toggle', [
            { v: 'toggle', t: '取反' }, { v: 'set', t: '置位' }, { v: 'clear', t: '复位' }
        ]);
        html += propColor('btnColor', '按钮色', w.btnColor);
    } else if (w.type === 'rect') {
        html += propNum('radius', '圆角', w.radius, 0, 60, '0');
        html += propColor('borderColor', '边框色', w.borderColor);
    }

    el.innerHTML = html;
    bindProps(el);
}

// 绑定属性栏事件（面板每次重建后重新绑定）
function bindProps(container) {
    var inputs = container.querySelectorAll('[data-prop]');
    for (var i = 0; i < inputs.length; i++) {
        inputs[i].addEventListener('change', onPropChange);
    }
    var clears = container.querySelectorAll('[data-clear]');
    for (var j = 0; j < clears.length; j++) {
        clears[j].addEventListener('click', onPropClear);
    }
}

function onPropChange() {
    var key = this.dataset.prop;
    if (!key) return;
    var value;
    if (this.type === 'checkbox') value = this.checked;
    else if (this.type === 'number') value = this.value === '' ? '' : Number(this.value);
    else value = this.value;

    pushUndo();
    var sel = getSelectedWidgets();
    for (var i = 0; i < sel.length; i++) {
        sel[i][key] = value;
        clampWidget(sel[i]);
    }
    refreshSelectedWidgets();
    scheduleSaveScreens();
}

function onPropClear() {
    var key = this.dataset.clear;
    if (!key) return;
    pushUndo();
    var sel = getSelectedWidgets();
    for (var i = 0; i < sel.length; i++) sel[i][key] = '';
    refreshSelectedWidgets();
    renderProps();
    scheduleSaveScreens();
}

// 限制组件几何在合理范围内
function clampWidget(w) {
    w.x = Math.max(0, Number(w.x) || 0);
    w.y = Math.max(0, Number(w.y) || 0);
    w.w = Math.max(20, Number(w.w) || 20);
    w.h = Math.max(20, Number(w.h) || 20);
}

// 只刷新选中组件的画布 DOM（不重建属性栏，避免输入框失焦）
function refreshSelectedWidgets() {
    var canvas = document.getElementById('screenCanvas');
    var sel = getSelectedWidgets();
    for (var i = 0; i < sel.length; i++) {
        var el = canvas.querySelector('.widget[data-id="' + sel[i].id + '"]');
        if (!el) continue;
        el.style.left = (sel[i].x || 0) + 'px';
        el.style.top = (sel[i].y || 0) + 'px';
        el.style.width = (sel[i].w || 100) + 'px';
        el.style.height = (sel[i].h || 40) + 'px';
        updateWidgetDom(sel[i], el);
    }
}

// ── 拖拽移动 / 缩放 / 多选 / 预览 ────────────────────────────
var dragState = null;

// 按网格吸附（10px）
function snapVal(v) {
    return state.snap ? Math.round(v / 10) * 10 : Math.round(v);
}

(function setupCanvasInteractions() {
    var canvas = document.getElementById('screenCanvas');
    var wrap = canvas.parentElement;   // .canvas-wrap：可滚动的容器

    canvas.addEventListener('mousedown', function (e) {
        if (state.preview) return;                       // 预览模式不进入编辑
        var wEl = e.target.closest('.widget');
        var additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (!wEl) { setSelection([]); return; }

        var id = wEl.dataset.id;
        var handle = e.target.closest('.widget-resize-handle');
        selectWidget(id, additive);
        if (additive) return;                            // 加选时不启动拖动

        var w = getWidget(id);
        if (!w) return;
        e.preventDefault();
        dragState = {
            mode: handle ? 'resize' : 'move',
            startX: e.clientX,
            startY: e.clientY,
            // 记录滚动位置：拖动过程中若容器滚动，坐标必须按滚动量补偿
            startScrollLeft: wrap ? wrap.scrollLeft : 0,
            startScrollTop: wrap ? wrap.scrollTop : 0,
            before: snapshotScreens(),
            // 记录全部选中组件的起始几何，实现整体移动 / 缩放
            items: getSelectedWidgets().map(function (it) {
                return { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h };
            })
        };
    });

    document.addEventListener('mousemove', function (e) {
        if (!dragState) return;
        // 用"画布坐标"计算位移：鼠标位移 + 容器滚动量
        var dx = e.clientX - dragState.startX + ((wrap ? wrap.scrollLeft : 0) - dragState.startScrollLeft);
        var dy = e.clientY - dragState.startY + ((wrap ? wrap.scrollTop : 0) - dragState.startScrollTop);

        var cw = canvas.clientWidth, ch = canvas.clientHeight;

        if (dragState.mode === 'move') {
            // 整组一起限制在画布范围内，避免拖出画布后组件"消失"，也避免组内相对位置被拆散
            var minX = Infinity, minY = Infinity, maxR = -Infinity, maxB = -Infinity;
            for (var k = 0; k < dragState.items.length; k++) {
                var it0 = dragState.items[k];
                minX = Math.min(minX, it0.x);
                minY = Math.min(minY, it0.y);
                maxR = Math.max(maxR, it0.x + it0.w);
                maxB = Math.max(maxB, it0.y + it0.h);
            }
            dx = Math.max(-minX, Math.min(cw - maxR, dx));
            dy = Math.max(-minY, Math.min(ch - maxB, dy));
        }

        for (var i = 0; i < dragState.items.length; i++) {
            var it = dragState.items[i];
            var w = getWidget(it.id);
            if (!w) continue;
            if (dragState.mode === 'move') {
                w.x = Math.max(0, snapVal(it.x + dx));
                w.y = Math.max(0, snapVal(it.y + dy));
            } else {
                // 缩放同样限制在画布内（右/下边界不越界）
                w.w = Math.max(20, Math.min(cw - it.x, snapVal(it.w + dx)));
                w.h = Math.max(20, Math.min(ch - it.y, snapVal(it.h + dy)));
            }
            var el = canvas.querySelector('.widget[data-id="' + it.id + '"]');
            if (el) {
                el.style.left = w.x + 'px';
                el.style.top = w.y + 'px';
                el.style.width = w.w + 'px';
                el.style.height = w.h + 'px';
            }
        }
    });

    document.addEventListener('mouseup', function () {
        if (!dragState) return;
        // 仅在实际发生位移 / 缩放时记录一次撤销点
        if (snapshotScreens() !== dragState.before) {
            undoStack.push(dragState.before);
            if (undoStack.length > undoLimit) undoStack.shift();
            redoStack.length = 0;
            scheduleSaveScreens();
        }
        dragState = null;
        refreshSelectedWidgets();
        renderProps();
    });

    // 预览模式下点击按钮组件执行写值
    canvas.addEventListener('click', function (e) {
        if (!state.preview) return;
        var btnEl = e.target.closest('.widget-button');
        if (!btnEl) return;
        var wEl = btnEl.closest('.widget');
        if (!wEl) return;
        var w = getWidget(wEl.dataset.id);
        if (w) runWidgetButton(w);
    });

    // 初始 UI 状态（网格 / 吸附默认开启）
    canvas.classList.toggle('no-grid', !state.showGrid);
})();

// ── 按钮组件写值（预览模式） ─────────────────────────────────
function runWidgetButton(w) {
    var idx = findTagIndex(w.tag);
    if (idx < 0) { showToast('该按钮未绑定标签', 'error'); return; }
    if (!state.connected) { showToast('PLC 未连接，无法写入。请先连接。', 'error'); return; }

    var tag = state.tags[idx];
    var action = w.action || 'toggle';
    var value;
    if (tag.dataType === 'Bool') {
        if (action === 'set') value = true;
        else if (action === 'clear') value = false;
        else value = !(tag.value === true);
    } else {
        if (action === 'set') value = 1;
        else if (action === 'clear') value = 0;
        else value = (typeof tag.value === 'number' ? tag.value + 1 : 1);
    }
    postToCSharp({ action: 'writeValue', index: idx, value: value });
}

// ── 网格 / 吸附 / 预览开关 ───────────────────────────────────
function toggleGrid() {
    state.showGrid = !state.showGrid;
    document.getElementById('screenCanvas').classList.toggle('no-grid', !state.showGrid);
    var btn = document.getElementById('btnGrid');
    if (btn) btn.classList.toggle('active', state.showGrid);
}

function toggleSnap() {
    state.snap = !state.snap;
    var btn = document.getElementById('btnSnap');
    if (btn) btn.classList.toggle('active', state.snap);
}

function togglePreview() {
    state.preview = !state.preview;
    document.getElementById('screenCanvas').classList.toggle('preview', state.preview);
    var btn = document.getElementById('btnPreview');
    if (btn) {
        btn.classList.toggle('active', state.preview);
        btn.textContent = state.preview ? '退出预览' : '预览';
    }
    if (state.preview) setSelection([]);
    renderProps();
}

// ── 对齐 / 层级 ──────────────────────────────────────────────
function alignWidgets(mode) {
    var sel = getSelectedWidgets();
    if (sel.length < 2) return;
    pushUndo();
    var lefts = [], rights = [], tops = [], bottoms = [];
    for (var i = 0; i < sel.length; i++) {
        lefts.push(sel[i].x);
        rights.push(sel[i].x + sel[i].w);
        tops.push(sel[i].y);
        bottoms.push(sel[i].y + sel[i].h);
    }
    var minL = Math.min.apply(null, lefts), maxR = Math.max.apply(null, rights);
    var minT = Math.min.apply(null, tops), maxB = Math.max.apply(null, bottoms);
    for (var j = 0; j < sel.length; j++) {
        var w = sel[j];
        if (mode === 'left') w.x = minL;
        else if (mode === 'right') w.x = maxR - w.w;
        else if (mode === 'top') w.y = minT;
        else if (mode === 'bottom') w.y = maxB - w.h;
        else if (mode === 'hcenter') w.x = Math.round((minL + maxR) / 2 - w.w / 2);
        else if (mode === 'vcenter') w.y = Math.round((minT + maxB) / 2 - w.h / 2);
        clampWidget(w);
    }
    renderScreens();
    scheduleSaveScreens();
}

function bringToFront() { reorderSelection(true); }
function sendToBack() { reorderSelection(false); }

// 调整选中组件在 widgets 数组中的顺序（数组顺序 = 绘制层级）
function reorderSelection(toFront) {
    var screen = state.screens[state.currentScreen];
    if (!screen || state.selectedWidgets.length === 0) return;
    pushUndo();
    var picked = [], rest = [];
    for (var i = 0; i < screen.widgets.length; i++) {
        if (state.selectedWidgets.indexOf(screen.widgets[i].id) >= 0) picked.push(screen.widgets[i]);
        else rest.push(screen.widgets[i]);
    }
    screen.widgets = toFront ? rest.concat(picked) : picked.concat(rest);
    renderScreens();
    scheduleSaveScreens();
}

// ── 复制 / 粘贴 / 撤销 / 重做 ────────────────────────────────
var undoStack = [];
var redoStack = [];
var undoLimit = 50;

function snapshotScreens() { return JSON.stringify(state.screens); }

function pushUndo() {
    undoStack.push(snapshotScreens());
    if (undoStack.length > undoLimit) undoStack.shift();
    redoStack.length = 0;
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshotScreens());
    state.screens = JSON.parse(undoStack.pop());
    afterHistory();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshotScreens());
    state.screens = JSON.parse(redoStack.pop());
    afterHistory();
}

function afterHistory() {
    if (state.currentScreen >= state.screens.length) state.currentScreen = state.screens.length - 1;
    if (state.currentScreen < 0 && state.screens.length > 0) state.currentScreen = 0;
    var screen = state.screens[state.currentScreen];
    if (screen) {
        state.selectedWidgets = state.selectedWidgets.filter(function (id) {
            return screen.widgets.some(function (w) { return w.id === id; });
        });
    } else {
        state.selectedWidgets = [];
    }
    renderScreens();
    scheduleSaveScreens();
}

function copySelection() {
    var sel = getSelectedWidgets();
    if (sel.length === 0) return;
    state.clipboard = sel.map(cloneWidget);
    showToast('已复制 ' + sel.length + ' 个组件');
}

function pasteClipboard() {
    var screen = state.screens[state.currentScreen];
    if (!screen || !state.clipboard || state.clipboard.length === 0) return;
    pushUndo();
    var ids = [];
    for (var i = 0; i < state.clipboard.length; i++) {
        var c = cloneWidget(state.clipboard[i]);
        c.id = newWidgetId();
        c.x = (Number(c.x) || 0) + 10;
        c.y = (Number(c.y) || 0) + 10;
        screen.widgets.push(c);
        ids.push(c.id);
    }
    // 连续粘贴时继续偏移，避免叠在一起
    state.clipboard = state.clipboard.map(function (item) {
        var c = cloneWidget(item);
        c.x = (Number(c.x) || 0) + 10;
        c.y = (Number(c.y) || 0) + 10;
        return c;
    });
    setSelection(ids);
    renderScreens();
    scheduleSaveScreens();
}

function duplicateSelection() {
    var sel = getSelectedWidgets();
    var screen = state.screens[state.currentScreen];
    if (!screen || sel.length === 0) return;
    pushUndo();
    var ids = [];
    for (var i = 0; i < sel.length; i++) {
        var c = cloneWidget(sel[i]);
        c.id = newWidgetId();
        c.x = (Number(c.x) || 0) + 10;
        c.y = (Number(c.y) || 0) + 10;
        screen.widgets.push(c);
        ids.push(c.id);
    }
    setSelection(ids);
    renderScreens();
    scheduleSaveScreens();
}

// ── 组件编辑快捷键（仅画面视图、且焦点不在输入控件时生效） ────
document.addEventListener('keydown', function (e) {
    if (state.view !== 'screens') return;
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;

    var ctrl = e.ctrlKey || e.metaKey;
    var key = (e.key || '').toLowerCase();

    if (ctrl && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (ctrl && key === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && key === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (ctrl && key === 'c') {
        // 页面上有文本选中时不劫持系统复制
        var selText = window.getSelection ? String(window.getSelection()) : '';
        if (!selText) copySelection();
        return;
    }
    if (ctrl && key === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedWidget(); return; }
    if (e.key === 'Escape') { setSelection([]); return; }

    if (state.selectedWidgets.length > 0) {
        var step = e.shiftKey ? 10 : 1;
        var dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;
        if (dx !== 0 || dy !== 0) {
            e.preventDefault();
            pushUndo();
            var list = getSelectedWidgets();
            for (var i = 0; i < list.length; i++) {
                list[i].x = Math.max(0, list[i].x + dx);
                list[i].y = Math.max(0, list[i].y + dy);
            }
            refreshSelectedWidgets();
            renderProps();
            scheduleSaveScreens();
        }
    }
});

// ── 自动保存（防抖） ─────────────────────────────────────────
var saveScreensTimer = null;
function scheduleSaveScreens() {
    if (saveScreensTimer) clearTimeout(saveScreensTimer);
    saveScreensTimer = setTimeout(function () {
        postToCSharp({ action: 'saveScreens', screens: state.screens });
    }, 500);
}

// ── Utility ───────────────────────────────────────────────────

function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function hexToRgba(hex, alpha) {
    if (!hex) return 'transparent';
    var h = hex.replace('#', '');
    // 兼容 3 位简写（如 #abc），其余非法值原样返回，避免拼出 rgba(…,NaN,…) 无效色
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (h.length !== 6) return hex;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
