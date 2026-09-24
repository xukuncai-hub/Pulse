/* ================================================================
   Pulse S7 监控台 — JavaScript Bridge & UI Controller
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
    selectedWidget: null,
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
    return getCssVar('--area-' + String(area || 'M').toLowerCase()) || COLOR_FALLBACK;
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
    var ip = document.getElementById('inputIp').value.trim();
    var rack = parseInt(document.getElementById('inputRack').value) || 0;
    var slot = parseInt(document.getElementById('inputSlot').value) || 1;
    var scanInterval = parseInt(document.getElementById('inputScan').value) || 500;
    var cpu = document.getElementById('inputCpu').value;

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

    postToCSharp({
        action: 'connect',
        ip: ip,
        rack: rack,
        slot: slot,
        scanInterval: scanInterval,
        cpu: cpu
    });
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
        var text = '区域: ' + parsed.area + '   |   类型: ' + parsed.dataType + '   |   字节偏移: ' + parsed.byteOffset;
        if (parsed.dataType === 'Bool') text += '   |   位: ' + parsed.bitOffset;
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

// Client-side address parser (mirrors AddressParser.cs)
function parseAddress(addr) {
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

    // 画面组件属性栏
    var propTag = document.getElementById('propTag');
    if (propTag) propTag.addEventListener('change', function () { updateSelectedProp('tag', this.value); });
    var propLabel = document.getElementById('propLabel');
    if (propLabel) propLabel.addEventListener('input', function () { updateSelectedProp('label', this.value); });
    var propFont = document.getElementById('propFont');
    if (propFont) propFont.addEventListener('change', function () { updateSelectedProp('font', parseInt(this.value) || 14); });

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
    state.selectedWidget = null;
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
    state.selectedWidget = null;
    renderScreens();
}

function addScreen() {
    var n = state.screens.length + 1;
    var name = '画面' + n;
    while (state.screens.some(function (s) { return s.name === name; })) n++;
    state.screens.push({ name: name, widgets: [] });
    state.currentScreen = state.screens.length - 1;
    state.selectedWidget = null;
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
    state.screens.splice(state.currentScreen, 1);
    if (state.currentScreen >= state.screens.length) state.currentScreen = state.screens.length - 1;
    state.selectedWidget = null;
    renderScreens();
    scheduleSaveScreens();
}

// ── 组件 CRUD ────────────────────────────────────────────────
function defaultWidget(type, id) {
    switch (type) {
        case 'value': return { id: id, type: 'value', label: '', tag: '', x: 120, y: 80, w: 180, h: 64, font: 20 };
        case 'lamp':  return { id: id, type: 'lamp',  label: '', tag: '', x: 400, y: 80, w: 56,  h: 56, font: 11 };
        case 'text':  return { id: id, type: 'text',  label: '文本', tag: '', x: 40,  y: 20, w: 160, h: 30, font: 16 };
    }
}

function getWidget(id) {
    var screen = state.screens[state.currentScreen];
    if (!screen) return null;
    for (var i = 0; i < screen.widgets.length; i++) {
        if (screen.widgets[i].id === id) return screen.widgets[i];
    }
    return null;
}

function addWidget(type) {
    var screen = state.screens[state.currentScreen];
    if (!screen) { showToast('请先新建一个画面', 'error'); return; }
    var w = defaultWidget(type, 'w' + Date.now().toString(36));
    screen.widgets.push(w);
    state.selectedWidget = w.id;
    renderScreens();
    scheduleSaveScreens();
}

function selectWidget(id) {
    state.selectedWidget = id;
    var widgets = document.querySelectorAll('#screenCanvas .widget');
    for (var i = 0; i < widgets.length; i++) {
        widgets[i].classList.toggle('selected', widgets[i].dataset.id === id);
    }
    renderProps();
}

function deleteSelectedWidget() {
    if (!state.selectedWidget) return;
    var screen = state.screens[state.currentScreen];
    if (!screen) return;
    screen.widgets = screen.widgets.filter(function (w) { return w.id !== state.selectedWidget; });
    state.selectedWidget = null;
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
    el.className = 'widget widget-' + w.type + (state.selectedWidget === w.id ? ' selected' : '');
    el.dataset.id = w.id;
    el.style.left = (w.x || 0) + 'px';
    el.style.top = (w.y || 0) + 'px';
    el.style.width = (w.w || 100) + 'px';
    el.style.height = (w.h || 50) + 'px';

    if (w.type === 'value') {
        el.innerHTML = '<div class="widget-label"></div><div class="widget-value-text"></div><div class="widget-resize-handle"></div>';
    } else if (w.type === 'lamp') {
        el.innerHTML = '<div class="widget-lamp-circle"></div><div class="widget-lamp-label"></div><div class="widget-resize-handle"></div>';
    } else if (w.type === 'text') {
        el.innerHTML = '<div class="widget-text-content"></div><div class="widget-resize-handle"></div>';
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

    if (w.type === 'value') {
        var labelEl = el.querySelector('.widget-label');
        if (labelEl) labelEl.textContent = w.label || (tag ? tag.name : '未绑定');
        var valEl = el.querySelector('.widget-value-text');
        if (valEl) {
            var quality = tag ? tag.quality : 'Unknown';
            valEl.textContent = formatValue(tag ? tag.value : null, quality);
            valEl.className = 'widget-value-text ' +
                (quality === 'Bad' ? 'bad' : quality === 'Unknown' ? 'unknown' : '');
            valEl.style.fontSize = (w.font || 20) + 'px';
        }
    } else if (w.type === 'lamp') {
        var circ = el.querySelector('.widget-lamp-circle');
        if (circ) {
            circ.className = 'widget-lamp-circle';
            if (tag && tag.quality === 'Good' && typeof tag.value === 'boolean') {
                circ.classList.add(tag.value ? 'on' : 'off');
            }
        }
        var lbl = el.querySelector('.widget-lamp-label');
        if (lbl) {
            lbl.textContent = w.label || (tag ? tag.name : '未绑定');
            lbl.style.fontSize = (w.font || 11) + 'px';
        }
    } else if (w.type === 'text') {
        var tc = el.querySelector('.widget-text-content');
        if (tc) {
            tc.textContent = w.label || '';
            tc.style.fontSize = (w.font || 16) + 'px';
        }
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

// ── 属性栏 ───────────────────────────────────────────────────
function renderProps() {
    var el = document.getElementById('widgetProps');
    var btnDel = document.getElementById('btnDeleteWidget');
    var w = state.selectedWidget ? getWidget(state.selectedWidget) : null;
    if (!w) {
        el.style.display = 'none';
        btnDel.disabled = true;
        return;
    }
    el.style.display = 'flex';
    btnDel.disabled = false;

    var sel = document.getElementById('propTag');
    var html = '<option value="">未绑定</option>';
    for (var i = 0; i < state.tags.length; i++) {
        var selAttr = w.tag === state.tags[i].name ? ' selected' : '';
        html += '<option value="' + esc(state.tags[i].name) + '"' + selAttr + '>' + esc(state.tags[i].name) + '</option>';
    }
    sel.innerHTML = html;

    document.getElementById('propLabel').value = w.label || '';
    document.getElementById('propFont').value = w.font || defaultFont(w.type);
}

// 各组件默认字号（与 defaultWidget 保持一致）
function defaultFont(type) {
    if (type === 'value') return 20;
    if (type === 'lamp') return 11;
    return 16;
}

function updateSelectedProp(key, value) {
    var w = state.selectedWidget ? getWidget(state.selectedWidget) : null;
    if (!w) return;
    w[key] = value;
    var el = document.querySelector('#screenCanvas .widget[data-id="' + w.id + '"]');
    if (el) updateWidgetDom(w, el);
    scheduleSaveScreens();
}

// ── 拖拽移动 / 缩放 ──────────────────────────────────────────
var dragState = null;

(function setupCanvasInteractions() {
    var canvas = document.getElementById('screenCanvas');
    canvas.addEventListener('mousedown', function (e) {
        var wEl = e.target.closest('.widget');
        if (!wEl) { selectWidget(null); return; }
        var handle = e.target.closest('.widget-resize-handle');
        var id = wEl.dataset.id;
        selectWidget(id);
        var w = getWidget(id);
        if (!w) return;
        e.preventDefault();
        dragState = {
            id: id,
            startX: e.clientX,
            startY: e.clientY,
            origX: w.x, origY: w.y, origW: w.w, origH: w.h,
            mode: handle ? 'resize' : 'move'
        };
    });

    document.addEventListener('mousemove', function (e) {
        if (!dragState) return;
        var w = getWidget(dragState.id);
        if (!w) { dragState = null; return; }
        var dx = e.clientX - dragState.startX;
        var dy = e.clientY - dragState.startY;
        if (dragState.mode === 'move') {
            w.x = Math.max(0, Math.round(dragState.origX + dx));
            w.y = Math.max(0, Math.round(dragState.origY + dy));
        } else {
            w.w = Math.max(40, Math.round(dragState.origW + dx));
            w.h = Math.max(24, Math.round(dragState.origH + dy));
        }
        var el = canvas.querySelector('.widget[data-id="' + dragState.id + '"]');
        if (el) {
            el.style.left = w.x + 'px';
            el.style.top = w.y + 'px';
            el.style.width = w.w + 'px';
            el.style.height = w.h + 'px';
        }
    });

    document.addEventListener('mouseup', function () {
        if (dragState) {
            dragState = null;
            scheduleSaveScreens();
        }
    });
})();

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
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
