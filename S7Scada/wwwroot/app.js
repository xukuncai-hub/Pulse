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

// UI translations only; PLC tag names, comments and screen content remain user data.
var currentLanguage = 'zh-CN';
var translations = {
    // 侧边栏与工具栏
    '侧边栏': 'Sidebar', '折叠 / 展开侧边栏（Ctrl+B）': 'Collapse / expand sidebar (Ctrl+B)', '折叠或展开侧边栏': 'Collapse or expand sidebar',
    '连接 PLC（F5）': 'Connect PLC (F5)', '连接 PLC': 'Connect PLC', '连接': 'Connect', '连接中…': 'Connecting…', '断开连接（F6）': 'Disconnect (F6)', '断开连接': 'Disconnect PLC', '断开': 'Disconnect',
    '添加标签（Ctrl+N）': 'Add tag (Ctrl+N)', '添加标签': 'Add tag', '保存标签配置（Ctrl+S）': 'Save tag configuration (Ctrl+S)', '保存配置': 'Save configuration', '保存': 'Save',
    '从 CSV 导入标签（追加到当前列表）': 'Import tags from CSV (append to current list)', '导入': 'Import', '把当前标签列表导出为 CSV': 'Export the current tag list as CSV', '导出': 'Export',
    '标签表视图': 'Tag table view', '标签表': 'Tags', '标签数据': 'Tag data', '画面编辑器': 'HMI editor', '画面': 'Screens', '历史趋势': 'History trend', '趋势': 'Trend',
    '切换明 / 暗主题': 'Toggle light / dark theme', '设置': 'Settings', '未连接': 'Disconnected', '已连接': 'Connected',

    // 通信协议与配置
    '通信协议': 'Protocol', 'S7（西门子）': 'S7 (Siemens)', 'Modbus TCP（以太网）': 'Modbus TCP (Ethernet)', 'Modbus RTU（RS485 / RS232）': 'Modbus RTU (RS485 / RS232)', '原始 TCP/IP 透传': 'Raw TCP/IP',
    'PLC IP 地址': 'PLC IP address', 'CPU 型号': 'CPU model', '机架': 'Rack', '插槽': 'Slot', '端口': 'Port', '从站号': 'Unit ID', '串口': 'Serial port', '检测': 'Detect', '重新检测可用串口': 'Detect available serial ports',
    '波特率': 'Baud rate', '数据位': 'Data bits', '停止位': 'Stop bits', '校验': 'Parity', '无 (None)': 'None', '偶校验 (Even)': 'Even', '奇校验 (Odd)': 'Odd',
    '发送报文（十六进制，可留空只接收）': 'Send frame (hex; leave blank to receive only)', '扫描周期 ms': 'Scan interval (ms)',
    '扫描周期已更新为 ': 'Scan interval updated to ', ' ms': ' ms', '扫描: ': 'Scan: ', '标签: ': 'Tags: ',

    // TIA Portal / Modbus / Raw TCP 设置指引
    'TIA Portal 设置': 'TIA Portal setup', 'CPU 属性 → 防护与安全 → 勾选"允许 PUT/GET 通信"': 'CPU properties → Protection & Security → Enable "Permit access with PUT/GET communication"',
    'DB 属性 → 取消勾选"优化的块访问"并重新编译': 'DB properties → Disable "Optimized block access" and recompile', '确认 CPU 处于 RUN 模式': 'Make sure the CPU is in RUN mode',
    'Modbus TCP 设置': 'Modbus TCP setup', '确认设备已启用 Modbus TCP 服务并开放端口（默认 502）': 'Enable Modbus TCP on the device and open its port (default: 502)',
    '从站号（Unit ID）需与设备组态一致，多数设备为 1': 'The Unit ID must match the device configuration (usually 1)', '寄存器按大端字序（高字在前 AB CD）解析': 'Registers use big-endian word order (high word first: AB CD)',
    'Modbus RTU 设置': 'Modbus RTU setup', 'RS485 为 A/B 两线半双工；RS232 为 TX/RX/GND，二者均使用下方同一组串口参数': 'RS485 uses two-wire half-duplex; RS232 uses TX/RX/GND. Both use the serial settings below.',
    '波特率 / 数据位 / 停止位 / 校验需与从站设备完全一致（默认 9600-8-N-1）': 'Baud rate, data bits, stop bits and parity must match the device (default: 9600-8-N-1)',
    '从站号需与设备地址一致；A/B 接反时通信会失败，可对调后再试': 'The Unit ID must match the device. If A/B are reversed, swap them and try again.', '寄存器地址写法与 Modbus TCP 一致：HR100 / 40001 / CO0': 'Register address syntax is the same as Modbus TCP: HR100 / 40001 / CO0',
    '原始 TCP/IP 设置': 'Raw TCP/IP setup', '用于无标准协议的自定义设备（扫码枪 / 称重仪 / 串口服务器等）': 'For custom devices without a standard protocol (barcode scanners, scales, serial servers, etc.)',
    '"发送报文"填十六进制，每次扫描前发送一次；留空则只接收设备主动上报的数据': 'Enter a hex frame in "Send frame" to send before each scan; leave blank to receive unsolicited data only.',
    '标签地址填响应数据中的字节偏移（0、4、8…），数据类型在标签里选择': 'Use the response byte offset (0, 4, 8…) as the tag address, and select the data type in the tag.',
    '只取一帧数据：设备停止发送后按空闲超时（IO 超时的 1/5）判定帧结束': 'One frame is read at a time; an idle timeout (1/5 of the I/O timeout) marks the end of a frame.',
    '地址格式': 'Address format', '快捷键': 'Shortcuts', '双击写值 · 右键菜单': 'Double-click to write · right-click for menu', '画面：Del 删除 · Ctrl+D 复制 · Ctrl+Z 撤销': 'Screens: Del delete · Ctrl+D duplicate · Ctrl+Z undo',
    'F5 连接      F6 断开': 'F5 Connect      F6 Disconnect',
    'Ctrl+N 添加标签': 'Ctrl+N Add tag',
    'Ctrl+S 保存配置': 'Ctrl+S Save config',
    'Ctrl+B 折叠侧边栏': 'Ctrl+B Toggle sidebar',

    // 表格与变量监控
    '实时数值': 'Live values', '标签名称': 'Tag name', '地址': 'Address', '分组': 'Group', '类型': 'Type', '数值': 'Value', '质量': 'Quality', '更新时间': 'Updated',
    '搜索名称 / 地址…': 'Search name / address…', '搜索标签': 'Search tags', '按分组筛选': 'Filter by group', '全部分组': 'All groups', '刷新': 'Refresh', '立即读取一次全部标签': 'Read all tags now',
    '还没有配置标签': 'No tags configured yet', '添加标签后即可实时监控 PLC 信号，支持': 'Add tags to monitor PLC signals in real time. Supported areas:', '地址区。': 'areas.', '也可以按': 'Or press', '快速添加。': 'to add quickly.',
    '没有符合筛选条件的标签': 'No tags match the filter criteria', '良好': 'Good', '异常': 'Fault', '未知': 'Unknown', '读取失败': 'Read failed',

    // 画面编辑器
    '浏览': 'Browse', '退出浏览': 'Exit browse', '编辑模式：右键修改属性 · 拖动调整组件': 'Edit mode: right-click to edit properties · drag to move widgets',
    '进入浏览模式并操作画面按钮': 'Enter browse mode to use screen buttons', '退出浏览模式并返回编辑': 'Exit browse mode and return to editing',
    '浏览模式：点击画面按钮执行操作 · 点击“退出浏览”返回编辑': 'Browse mode: click screen buttons to act · click "Exit browse" to return to editing',
    '编辑模式：右键修改属性 · 拖动调整组件 · 点击“浏览”操作画面': 'Edit mode: right-click to edit properties · drag to move widgets · click "Browse" to interact',
    '模式': 'Mode', '编辑': 'Edit', '删除选中': 'Delete selected', '层级': 'Layer', '对齐': 'Align', '画布': 'Canvas', '添加组件': 'Add widget',
    '新建画面': 'New screen', '重命名': 'Rename', '删除': 'Delete', '新增一个画面': 'Create a new screen', '重命名当前画面': 'Rename current screen', '删除当前画面': 'Delete current screen',
    '添加数值显示组件': 'Add value display', '添加指示灯组件': 'Add indicator lamp', '添加文本组件': 'Add text widget', '添加棒图 / 进度条组件': 'Add bar / progress widget', '添加按钮组件（浏览模式下点击可写值）': 'Add button (click to write in browse mode)',
    '添加矩形色块 / 装饰框': 'Add rectangle / decoration', '添加圆形仪表': 'Add circular gauge',
    '添加开关（浏览模式下写入 Bool 标签）': 'Add switch (writes a Bool tag in browse mode)', '添加状态 / 报警指示': 'Add status / alarm indicator', '添加迷你趋势图': 'Add mini trend chart',
    '数值': 'Value', '指示灯': 'Lamp', '文本': 'Text', '棒图': 'Bar', '按钮': 'Button', '矩形': 'Rectangle', '仪表': 'Gauge', '开关': 'Switch', '报警': 'Alarm', '迷你趋势': 'Mini trend',
    '置顶': 'Front', '置底': 'Back', '修改组件属性': 'Edit widget properties', '属性更改会自动保存 · 按 Esc 关闭': 'Changes are saved automatically · Press Esc to close',
    '左对齐': 'Align left', '右对齐': 'Align right', '顶对齐': 'Align top', '底对齐': 'Align bottom', '水平居中': 'Center horizontally', '垂直居中': 'Center vertically', '左': 'Left', '右': 'Right', '顶': 'Top', '底': 'Bottom',
    '显示 / 隐藏网格': 'Show / hide grid', '网格': 'Grid', '拖动 / 缩放吸附到网格': 'Snap drag / resize to grid', '吸附': 'Snap', '置于顶层': 'Bring to front', '置于底层': 'Send to back',
    '还没有画面': 'No screens yet', '点击右上角': 'Click the top-right', '创建一个上位机画面': 'to create an HMI screen', '然后在画布上添加组件：数值 / 指示灯 / 文本 / 棒图 / 按钮 / 矩形': 'Then add widgets to the canvas: value / lamp / text / bar / button / rectangle',
    '在画布上选中组件即可在此编辑属性': 'Select a widget on the canvas to edit properties', '选中组件后，在此编辑它的属性': 'Select a widget to edit its properties',
    '已选': 'Selected', '个组件': 'widgets', '样式': 'Style', '位置与尺寸': 'Position & Size', '标签与内容': 'Tag & Content',
    '颜色': 'Color', '字号': 'Font size', '加粗': 'Bold', '宽': 'Width', '高': 'Height', '边框': 'Border',
    '文字色': 'Text color', '背景色': 'Background', '绑定标签': 'Bind tag', '显示文字': 'Display text', '留空则显示标签名': 'Leave blank to use tag name',
    '单位': 'Unit', '如 ℃ / rpm': 'e.g. ℃ / rpm', '如 ℃ / %': 'e.g. ℃ / %', '小数位': 'Decimals', 'ON 文字': 'ON text', '留空用显示文字': 'Leave blank to use display text',
    'OFF 文字': 'OFF text', 'ON 颜色': 'ON color', '内容': 'Content', '输入文本内容': 'Enter text content', '标签': 'Tag', '可留空': 'Can be blank',
    '最小值': 'Min', '最大值': 'Max', '填充色': 'Fill color', '按钮文字': 'Button text', '动作': 'Action', '取反': 'Toggle', '置位': 'Set', '复位': 'Reset',
    '按钮色': 'Button color', '圆角': 'Radius', '边框色': 'Border color', '标题': 'Title', '指针色': 'Needle color', '开启文字': 'Switch ON text', '关闭文字': 'Switch OFF text',
    '开启颜色': 'Switch ON color', '报警文字': 'Alarm text', '正常文字': 'Normal text', '报警阈值': 'Alarm threshold', '数值标签使用': 'Used for numeric tags',
    '比较方式': 'Compare', '大于等于': 'Greater or equal (>=)', '小于': 'Less than (<)', 'Bool 报警条件': 'Bool alarm condition', '为真时报警': 'Alarm when True',
    '为假时报警': 'Alarm when False', '报警颜色': 'Alarm color', '纵轴最小值': 'Y-axis min', '纵轴最大值': 'Y-axis max', '自动': 'Auto', '可选': 'Optional',
    '曲线色': 'Trace color', '画布坐标': 'Canvas coordinates', '未绑定': 'Unbound', '未绑定标签': 'Tag unbound', '无数据': 'No data', '正常': 'Normal',
    '多个值': 'Multiple values', '恢复默认': 'Reset to default', '居中': 'Center', '单击切换 · 双击重命名': 'Click to switch · Double-click to rename',

    // 历史趋势
    '选择标签（最多 6 个）': 'Select tags (up to 6)', '清空': 'Clear', '清空选择': 'Clear selection', '显示范围': 'Time range', '趋势显示时间范围': 'Trend time range',
    '最近 1 分钟': 'Last 1 minute', '最近 5 分钟': 'Last 5 minutes', '最近 10 分钟': 'Last 10 minutes', '清除历史': 'Clear history', '清除已选曲线的历史数据': 'Clear history for selected traces',
    '已清除所选曲线历史': 'History cleared for selected traces',
    '勾选左侧标签后开始采样，最多保留最近 10 分钟数据': 'Select tags on the left to start sampling. Up to 10 minutes of data is kept.',
    '正在采样…': 'Sampling…', '正在采集趋势数据': 'Sampling trend data…', '无历史数据': 'No history',
    '等待所选标签产生有效数值后绘制曲线': 'Waiting for valid values for selected tags to draw curve',
    '所选标签出现有效数值后，曲线将显示在图表中': 'Curves will appear once selected tags have valid values',
    'Bool 类型不绘制趋势': 'Bool tags do not plot trends',

    // 弹窗与表单
    '写入数值': 'Write value', '写入数值…': 'Write value…', '新值': 'New value', '输入数值（0x 前缀表示十六进制）': 'Enter a value (use 0x prefix for hexadecimal)', '取消': 'Cancel', '确定': 'OK', '写入': 'Write',
    '编辑标签…': 'Edit tag…', '编辑标签': 'Edit tag', '标签名称': 'Tag name', '例如：电机转速': 'e.g. Motor speed', '例如：DB1.DBW2': 'e.g. DB1.DBW2', '数据类型': 'Data type', '备注': 'Comment', '可选说明': 'Optional description',
    '缩放系数': 'Scale', '偏移量': 'Offset', '启用扫描': 'Enable scanning', '停用扫描': 'Disable scanning', '输入地址后自动解析…': 'Address will be parsed automatically…', '无法解析该地址，请检查格式': 'Unable to parse this address. Check the format.',
    '显示值 = 原始值 × 缩放 + 偏移（1 表示不缩放）': 'Displayed value = raw value × scale + offset (1 = no scaling)', '显示值 = 原始值 × 缩放 + 偏移（0 表示不偏移）': 'Displayed value = raw value × scale + offset (0 = no offset)',
    '显示值 = 原始值 × 缩放 + 偏移': 'Displayed value = raw value × scale + offset',
    '当前值: ': 'Current value: ', '双击': 'Double-click', '删除标签': 'Delete tag', '关于': 'About',
    '关于 Pulse': 'About Pulse', '名称': 'Name', '作者': 'Author', '邮箱': 'Email', '技术栈': 'Technology', '源码': 'Source', 'Pulse · 版本 v1.3.0': 'Pulse · Version v1.3.0',
    '西门子 S7 / Modbus / 原始 TCP 上位机监控软件': 'Siemens S7 / Modbus / Raw TCP monitoring software', '现场脉搏，实时可见': 'Your process, visible in real time', '仅供学习与内部使用': 'For learning and internal use only',

    // 设置弹窗
    '外观': 'Appearance', '数值显示': 'Value display', '连接行为': 'Connection',
    '紧凑界面': 'Compact layout', '减少卡片和控件间距，保留文字大小': 'Reduce spacing between cards and controls while keeping text size', '语言 / Language': 'Language', '简体中文': '简体中文',
    '数值变化闪烁高亮': 'Flash on value change', '数值更新时短暂高亮单元格，方便捕捉变化': 'Briefly highlight cells when values update',
    '小数位数': 'Decimal places', '仅影响浮点数（Real）的显示精度': 'Affects only floating-point (Real) display precision',
    '自动（保留原精度）': 'Auto (keep original precision)', '0 位': '0 places', '1 位': '1 place', '2 位': '2 places', '3 位': '3 places', '4 位': '4 places',
    '断线自动重连': 'Auto-reconnect', '连接中断后每 5 秒自动尝试重连': 'Retry automatically every 5 s after a lost connection',
    '连接超时 (ms)': 'Connection timeout (ms)', '等待 PLC 响应的最长时间': 'Maximum time to wait for a PLC response', '完成': 'Done', '关闭': 'Close',

    // 快捷提示与地址示例
    'DB1.DBX0.0   位 / Bool': 'DB1.DBX0.0   Bit / Bool', 'DB1.DBB0     Byte': 'DB1.DBB0     Byte', 'DB1.DBW2     Word / Int': 'DB1.DBW2     Word / Int', 'DB1.DBD4     DWord / DInt / Real': 'DB1.DBD4     DWord / DInt / Real',
    'M0.0  M 位    I0.0  输入': 'M0.0  M bit    I0.0  Input', 'Q0.0  输出    MW2   M 字': 'Q0.0  Output    MW2   M word', 'T0    定时器  C0    计数器': 'T0    Timer    C0    Counter', '—— Modbus ——': '—— Modbus ——',
    'HR100 保持寄存器(读写)': 'HR100 Holding register (R/W)', 'IR100 输入寄存器(只读)': 'IR100 Input register (read-only)', 'CO0   线圈(读写)  DI0 离散输入': 'CO0   Coil (R/W)  DI0 Discrete input', '40001 / 30001 / 10001 / 00001': '40001 / 30001 / 10001 / 00001',
    '—— Modbus RTU ——': '—— Modbus RTU ——', '地址写法同 Modbus TCP': 'Address syntax is the same as Modbus TCP', '—— 原始 TCP ——': '—— Raw TCP ——', '0 / 4 / 8  响应字节偏移': '0 / 4 / 8  Response byte offsets',
    '版本': 'Version', '默认': 'Default', '型号': 'Model', '固件': 'Firmware', '序列号': 'Serial number',
    '例如：HR100 / 40001 / CO0': 'e.g. HR100 / 40001 / CO0',
    '例如：0（响应字节偏移）': 'e.g. 0 (response byte offset)',
    '例如：01 03 00 00 00 0A': 'e.g. 01 03 00 00 00 0A',

    // 提示信息 (Toast / 验证)
    '请先填写设备 IP 地址': 'Please enter device IP address', '请填写标签名称': 'Please enter tag name', '请填写地址': 'Please enter address',
    '标签名已存在，请使用唯一名称': 'Tag name already exists, please use a unique name', '地址无法解析，请检查格式（如 DB1.DBW2 / M0.0）': 'Cannot parse address. Please check format (e.g. DB1.DBW2 / M0.0)',
    'PLC 未连接，无法写入。请先连接。': 'PLC not connected; cannot write. Please connect first.', 'PLC 未连接，无法切换。请先连接。': 'PLC not connected; cannot toggle. Please connect first.',
    '标签配置已保存': 'Tag configuration saved', '请先新建一个画面': 'Please create a screen first',
    '该按钮未绑定标签': 'This button is not bound to a tag', '该开关未绑定标签': 'This switch is not bound to a tag',
    '开关组件只能绑定 Bool 标签': 'Switches can only be bound to Bool tags',
    '保持寄存器(4x)': 'Holding reg (4x)', '输入寄存器(3x)': 'Input reg (3x)', '线圈(0x)': 'Coil (0x)', '离散输入(1x)': 'Discrete input (1x)', '原始数据': 'Raw data',
    '当前没有标签可导出': 'No tags to export',
    '请输入要写入的值': 'Please enter a value to write',
    'Bool 只接受 true / false（或 1 / 0）': 'Bool only accepts true / false (or 1 / 0)',
    '请输入有效的浮点数': 'Please enter a valid float',
    '十六进制格式不正确，例如 0x1F': 'Invalid hex format, e.g. 0x1F',
    '请输入整数': 'Please enter an integer',
    '无法解析该数值': 'Cannot parse value',
    'Byte 取值范围 0 ~ 255': 'Byte range: 0 ~ 255',
    'Word 取值范围 0 ~ 65535': 'Word range: 0 ~ 65535',
    'DWord 取值范围 0 ~ 4294967295': 'DWord range: 0 ~ 4294967295',
    'Int 取值范围 -32768 ~ 32767': 'Int range: -32768 ~ 32767',
    'DInt 取值范围 -2147483648 ~ 2147483647': 'DInt range: -2147483648 ~ 2147483647'
};

var reverseTranslations = {};
var normalizedTranslations = {};
Object.keys(translations).forEach(function (key) {
    var kNorm = key.trim().replace(/\s+/g, ' ');
    var val = translations[key];
    var vNorm = val.trim().replace(/\s+/g, ' ');
    normalizedTranslations[kNorm] = val;
    normalizedTranslations[key] = val;
    reverseTranslations[vNorm] = key;
    reverseTranslations[val] = key;
});

function translateText(value, language) {
    if (!value || typeof value !== 'string') return value;
    if (value.indexOf('\n') >= 0) {
        return value.split('\n').map(function (line) {
            return translateText(line, language);
        }).join('\n');
    }
    var dictionary = language === 'en-US' ? normalizedTranslations : reverseTranslations;
    var trimmed = value.trim();
    var normalized = trimmed.replace(/\s+/g, ' ');
    var translated = dictionary[normalized] || dictionary[trimmed];

    if (!translated && language === 'en-US') {
        if (/^标签:\s*\d+$/.test(normalized)) translated = 'Tags: ' + normalized.split(':')[1].trim();
        else if (/^扫描:\s*[\d.]+\s*ms$/.test(normalized)) translated = normalized.replace(/^扫描:/, 'Scan:');
        else if (/^扫描周期已更新为\s*\d+\s*ms$/.test(normalized)) translated = normalized.replace('扫描周期已更新为', 'Scan interval updated to');
        else if (/^最多同时显示\s*\d+\s*条曲线$/.test(normalized)) translated = normalized.replace('最多同时显示', 'You can display up to').replace('条曲线', 'traces');
        else if (/^已复制\s*\d+\s*个组件$/.test(normalized)) translated = normalized.replace('已复制', 'Copied').replace('个组件', 'widgets');
        else if (/^已选\s*\d+\s*个组件$/.test(normalized)) translated = normalized.replace('已选', 'Selected').replace('个组件', 'widgets');
        else if (/^已导出\s*(\d+)\s*个标签到[：:]\s*(.+)$/.test(normalized)) translated = normalized.replace(/^已导出\s*(\d+)\s*个标签到[：:]\s*(.+)$/, 'Exported $1 tags to: $2');
        else if (/^已加载配置[（(]\s*(\d+)\s*个标签[）)]$/.test(normalized)) translated = normalized.replace(/^已加载配置[（(]\s*(\d+)\s*个标签[）)]$/, 'Loaded configuration ($1 tags)');
        else if (/^已保存到[：:]\s*(.+)$/.test(normalized)) translated = normalized.replace(/^已保存到[：:]\s*(.+)$/, 'Saved to: $1');
        else if (/^连接失败[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^连接失败[：:]\s*/, 'Connection failed: ');
        else if (/^扫描中断[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^扫描中断[：:]\s*/, 'Scan interrupted: ');
        else if (/^PLC\s*扫描中断[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^PLC\s*扫描中断[：:]\s*/, 'PLC scan interrupted: ');
        else if (/^保存失败[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^保存失败[：:]\s*/, 'Save failed: ');
        else if (/^加载失败[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^加载失败[：:]\s*/, 'Load failed: ');
        else if (/^导入失败[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^导入失败[：:]\s*/, 'Import failed: ');
        else if (/^导出失败[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^导出失败[：:]\s*/, 'Export failed: ');
        else if (/^保存画面失败[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^保存画面失败[：:]\s*/, 'Failed to save screens: ');
        else if (/^地址无法解析[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^地址无法解析[：:]\s*/, 'Cannot parse address: ');
        else if (/^IP\s*地址格式不正确[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^IP\s*地址格式不正确[：:]\s*/, 'Invalid IP address format: ');
        else if (/^(.+)[：:]\s*写入成功$/.test(normalized)) translated = normalized.replace(/^(.+)[：:]\s*写入成功$/, '$1: Written successfully');
        else if (/^(.+)[：:]\s*值无效$/.test(normalized)) translated = normalized.replace(/^(.+)[：:]\s*值无效$/, '$1: Invalid value');
        else if (/^(.+)[：:]\s*值无法转换[（(](.+)[）)]$/.test(normalized)) translated = normalized.replace(/^(.+)[：:]\s*值无法转换[（(](.+)[）)]$/, '$1: Value cannot be converted ($2)');
        else if (/^标签名称[“"'](.+)[”"']已存在，请使用唯一名称$/.test(normalized)) translated = normalized.replace(/^标签名称[“"'](.+)[”"']已存在，请使用唯一名称$/, 'Tag name "$1" already exists, please use a unique name');
        else if (/^当前值[：:]\s*(.*)$/.test(normalized)) translated = normalized.replace(/^当前值[：:]\s*/, 'Current value: ');
        else if (/^Pulse\s*·\s*版本\s*v(.*)$/.test(normalized)) translated = normalized.replace(/^Pulse\s*·\s*版本\s*v/, 'Pulse · Version v');
    } else if (!translated && language !== 'en-US') {
        if (/^Tags:\s*\d+$/.test(normalized)) translated = '标签: ' + normalized.split(':')[1].trim();
        else if (/^Scan:\s*[\d.]+\s*ms$/.test(normalized)) translated = normalized.replace(/^Scan:/, '扫描:');
        else if (/^Scan interval updated to\s*\d+\s*ms$/.test(normalized)) translated = normalized.replace('Scan interval updated to', '扫描周期已更新为');
        else if (/^You can display up to\s*\d+\s*traces$/.test(normalized)) translated = normalized.replace('You can display up to', '最多同时显示').replace('traces', '条曲线');
        else if (/^Copied\s*\d+\s*widgets$/.test(normalized)) translated = normalized.replace('Copied', '已复制').replace('widgets', '个组件');
        else if (/^Selected\s*\d+\s*widgets$/.test(normalized)) translated = normalized.replace('Selected', '已选').replace('widgets', '个组件');
        else if (/^Exported\s*(\d+)\s*tags to[：:]\s*(.+)$/i.test(normalized)) translated = normalized.replace(/^Exported\s*(\d+)\s*tags to[：:]\s*(.+)$/i, '已导出 $1 个标签到：$2');
        else if (/^Loaded configuration[（(]\s*(\d+)\s*tags[）)]$/i.test(normalized)) translated = normalized.replace(/^Loaded configuration[（(]\s*(\d+)\s*tags[）)]$/i, '已加载配置（$1 个标签）');
        else if (/^Saved to[：:]\s*(.+)$/i.test(normalized)) translated = normalized.replace(/^Saved to[：:]\s*(.+)$/i, '已保存到：$1');
        else if (/^Connection failed[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Connection failed[：:]\s*/i, '连接失败：');
        else if (/^Scan interrupted[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Scan interrupted[：:]\s*/i, '扫描中断：');
        else if (/^PLC scan interrupted[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^PLC scan interrupted[：:]\s*/i, 'PLC 扫描中断：');
        else if (/^Save failed[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Save failed[：:]\s*/i, '保存失败：');
        else if (/^Load failed[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Load failed[：:]\s*/i, '加载失败：');
        else if (/^Import failed[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Import failed[：:]\s*/i, '导入失败：');
        else if (/^Export failed[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Export failed[：:]\s*/i, '导出失败：');
        else if (/^Failed to save screens[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Failed to save screens[：:]\s*/i, '保存画面失败：');
        else if (/^Cannot parse address[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Cannot parse address[：:]\s*/i, '地址无法解析：');
        else if (/^Invalid IP address format[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Invalid IP address format[：:]\s*/i, 'IP 地址格式不正确：');
        else if (/^(.+)[：:]\s*Written successfully$/i.test(normalized)) translated = normalized.replace(/^(.+)[：:]\s*Written successfully$/i, '$1: 写入成功');
        else if (/^(.+)[：:]\s*Invalid value$/i.test(normalized)) translated = normalized.replace(/^(.+)[：:]\s*Invalid value$/i, '$1: 值无效');
        else if (/^(.+)[：:]\s*Value cannot be converted[（(](.+)[）)]$/i.test(normalized)) translated = normalized.replace(/^(.+)[：:]\s*Value cannot be converted[（(](.+)[）)]$/i, '$1: 值无法转换（$2）');
        else if (/^Tag name [“"'](.+)[”"'] already exists, please use a unique name$/i.test(normalized)) translated = normalized.replace(/^Tag name [“"'](.+)[”"'] already exists, please use a unique name$/i, '标签名称“$1”已存在，请使用唯一名称');
        else if (/^Current value[：:]\s*(.*)$/i.test(normalized)) translated = normalized.replace(/^Current value[：:]\s*/i, '当前值: ');
        else if (/^Pulse\s*·\s*Version\s*v(.*)$/i.test(normalized)) translated = normalized.replace(/^Pulse\s*·\s*Version\s*v/i, 'Pulse · 版本 v');
    }

    if (!translated) return value;
    var leading = value.match(/^\s*/)[0];
    var trailing = value.match(/\s*$/)[0];
    return leading + translated + trailing;
}

function isUserContent(node) {
    var parent = node.nodeType === 1 ? node : node.parentElement;
    if (!parent || !parent.closest) return false;
    return !!parent.closest('.dash-name, .dash-addr, .dash-value, .data-table tbody, #trendTagList, #trendTooltip, #screenTabs, #screenCanvas, .dd-menu, .write-name, .write-addr, .write-current, #connIp, #connPlcInfo, #statusPlcInfo, #plcDetail, [data-user-content]') ||
        !!(parent.tagName === 'OPTION' && parent.parentElement && (parent.parentElement.id === 'filterGroup' || parent.parentElement.getAttribute('data-prop') === 'tag'));
}

function applyLocalization(language, root) {
    currentLanguage = language === 'en-US' ? 'en-US' : 'zh-CN';
    root = root || document.body;
    document.documentElement.lang = currentLanguage;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (var i = 0; i < textNodes.length; i++) {
        var parent = textNodes[i].parentElement;
        if (!parent || /^(SCRIPT|STYLE|TEXTAREA)$/.test(parent.tagName) || isUserContent(textNodes[i])) continue;
        var translatedText = translateText(textNodes[i].nodeValue, currentLanguage);
        if (translatedText !== textNodes[i].nodeValue) textNodes[i].nodeValue = translatedText;
    }

    var attrs = ['title', 'aria-label', 'placeholder'];
    var elements = root.nodeType === 1 ? [root] : [];
    var descendants = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var j = 0; j < descendants.length; j++) elements.push(descendants[j]);
    for (var k = 0; k < elements.length; k++) {
        for (var a = 0; a < attrs.length; a++) {
            var attr = attrs[a];
            if (elements[k].hasAttribute(attr) && !isUserContent(elements[k])) {
                var value = elements[k].getAttribute(attr);
                var translatedAttr = translateText(value, currentLanguage);
                if (translatedAttr !== value) elements[k].setAttribute(attr, translatedAttr);
            }
        }
    }

    var selects = root.querySelectorAll ? root.querySelectorAll('select.field-input') : [];
    for (var s = 0; s < selects.length; s++) {
        var hit = selects[s].parentElement && selects[s].parentElement.querySelector('.dd-hit');
        var label = selects[s].id ? document.querySelector('label[for="' + selects[s].id + '"]') : null;
        if (hit && label) hit.setAttribute('aria-label', label.textContent.trim());
    }
}

function t(text) {
    return translateText(text, currentLanguage);
}

function openSettings() {
    var overlay = document.getElementById('settingsModal');
    if (!overlay) return;
    var language        = document.getElementById('settingLanguage');
    var compact         = document.getElementById('settingCompact');
    var flash           = document.getElementById('settingFlash');
    var decimals        = document.getElementById('settingDecimals');
    var autoReconnect   = document.getElementById('settingAutoReconnect');
    var connTimeout     = document.getElementById('settingConnTimeout');
    if (language)      language.value       = currentLanguage;
    if (compact)       compact.checked      = document.body.classList.contains('compact-ui');
    if (flash)         flash.checked        = localStorage.getItem('scada-flash') !== 'false';
    if (decimals)      decimals.value       = localStorage.getItem('scada-decimals') || '-1';
    if (autoReconnect) autoReconnect.checked = localStorage.getItem('scada-autoreconnect') === 'true';
    if (connTimeout)   connTimeout.value    = localStorage.getItem('scada-conntimeout') || '5000';
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
    var overlay = document.getElementById('settingsModal');
    if (!overlay) return;
    var compact       = document.getElementById('settingCompact');
    var decimals      = document.getElementById('settingDecimals');
    var connTimeout   = document.getElementById('settingConnTimeout');
    var autoReconnect = document.getElementById('settingAutoReconnect');
    var flash         = document.getElementById('settingFlash');
    if (compact)       { localStorage.setItem('scada-compact', compact.checked ? 'true' : 'false'); document.body.classList.toggle('compact-ui', compact.checked); }
    if (decimals)      { localStorage.setItem('scada-decimals', decimals.value); applyDecimalsSetting(); }
    if (connTimeout)   { localStorage.setItem('scada-conntimeout', connTimeout.value); applyConnTimeoutSetting(); }
    if (autoReconnect) { localStorage.setItem('scada-autoreconnect', autoReconnect.checked ? 'true' : 'false'); applyAutoReconnectSetting(); }
    if (flash)         { localStorage.setItem('scada-flash', flash.checked ? 'true' : 'false'); applyFlashSetting(); }
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
}

function toggleCompact(enabled) {
    localStorage.setItem('scada-compact', enabled ? 'true' : 'false');
    document.body.classList.toggle('compact-ui', !!enabled);
}

function toggleFlash(enabled) {
    localStorage.setItem('scada-flash', enabled ? 'true' : 'false');
    applyFlashSetting();
}

// 小数位数：重新渲染标签表/仪表盘使精度生效
function applyDecimalsSetting() {
    if (state.tags.length) { renderDashboard(); renderTable(); }
}

// 闪烁高亮：body class 控制
function applyFlashSetting() {
    var enabled = localStorage.getItem('scada-flash') !== 'false';
    document.body.classList.toggle('no-flash', !enabled);
}

// 连接超时：通知 C# 后端
function applyConnTimeoutSetting() {
    var ms = parseInt(localStorage.getItem('scada-conntimeout') || '5000', 10);
    postToCSharp({ action: 'setConnTimeout', timeoutMs: ms });
}

// 自动重连开关：通知 C# 后端
function applyAutoReconnectSetting() {
    var enabled = localStorage.getItem('scada-autoreconnect') === 'true';
    postToCSharp({ action: 'setAutoReconnect', enabled: enabled });
}

// 全局可读的小数位设置
function getDecimalPlaces() {
    return parseInt(localStorage.getItem('scada-decimals') || '-1', 10);
}

// 格式化数值（供 renderTable / renderDashboard 调用，统一精度设定）
function formatValue(raw, dataType) {
    if (raw === null || raw === undefined) return '—';
    if (dataType === 'Real') {
        var dec = getDecimalPlaces();
        if (dec >= 0) return Number(raw).toFixed(dec);
    }
    return String(raw);
}

function setLanguage(language) {
    currentLanguage = language === 'en-US' ? 'en-US' : 'zh-CN';
    localStorage.setItem('scada-lang', currentLanguage);
    if (ddActiveHit) closeDdMenu();
    applyLocalization(currentLanguage, document.body);
    renderDashboard();
    renderTable();
    updateTagCount();
    if (state.connected || document.getElementById('connStatus')) updateConnectionUI(state.connected, null, false);
    if (state.screens.length) renderScreens();
    if (state.selectedWidgets.length) renderProps();
    if (state.view === 'trend') { renderTrendTagList(); drawTrend(); }
    var scanEl = document.getElementById('statusScanTime');
    if (scanEl && state.scanTime) {
        scanEl.textContent = (currentLanguage === 'en-US' ? 'Scan: ' : '扫描: ') + state.scanTime.toFixed(1) + ' ms';
    }
    updateAboutVersion();
    updateScreenModeUI();
    onProtocolChanged();
    applyLocalization(currentLanguage, document.body);
}

function applySavedPreferences() {
    var language = localStorage.getItem('scada-lang') || 'zh-CN';
    currentLanguage = language === 'en-US' ? 'en-US' : 'zh-CN';
    document.body.classList.toggle('compact-ui', localStorage.getItem('scada-compact') === 'true');
    applyFlashSetting();
    applyConnTimeoutSetting();
    applyAutoReconnectSetting();
    applyLocalization(currentLanguage, document.body);
    if (typeof MutationObserver !== 'undefined') {
        var localizationObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].type === 'characterData') {
                    if (!isUserContent(mutations[i].target)) applyLocalization(currentLanguage, mutations[i].target.parentElement);
                } else {
                    for (var j = 0; j < mutations[i].addedNodes.length; j++) {
                        var node = mutations[i].addedNodes[j];
                        if (node.nodeType === 1 && !isUserContent(node)) applyLocalization(currentLanguage, node);
                    }
                }
            }
        });
        localizationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
}

applySavedPreferences();

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
    // 原始 TCP 透传的响应数据区
    else if (key === 'RawData') key = 'raw';
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
    toast.textContent = translateText(message, currentLanguage);
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
    state.appVersion = msg.version;
    state.appName = msg.name || 'Pulse';
    updateAboutVersion();
};

function updateAboutVersion() {
    var el = document.querySelector('.about-ver');
    if (el) {
        var verLabel = currentLanguage === 'en-US' ? 'Version v' : '版本 v';
        el.textContent = (state.appName || 'Pulse') + ' · ' + verLabel + (state.appVersion || '1.3.0');
    }
}

window.onDataUpdated = function (results) {
    if (!results || !Array.isArray(results)) return;
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (r.index >= 0 && r.index < state.tags.length) {
            state.tags[r.index].value = r.value;
            state.tags[r.index].quality = r.quality;
            state.tags[r.index].errorMessage = r.errorMessage || '';
            state.tags[r.index].timestamp = r.timestamp;
        }
    }
    recordHistory(results);
    updateDashboardValues();
    updateTableValues();
    updateScreenWidgets();
    if (state.view === 'trend') drawTrend();
};

window.onScanTime = function (ms) {
    state.scanTime = ms;
    var el = document.getElementById('statusScanTime');
    if (el) el.textContent = (currentLanguage === 'en-US' ? 'Scan: ' : '扫描: ') + ms.toFixed(1) + ' ms';
};

window.onTagsChanged = function (tags) {
    state.tags = tags || [];
    // 历史数据按标签索引存储，增删改会导致索引位移而错位，直接清空重新累积
    state.history = {};
    state.trendSel = [];
    renderDashboard();
    renderTable();
    updateTagCount();
    renderProps(); // 组件绑定下拉随标签增删刷新
    if (state.view === 'trend') { renderTrendTagList(); drawTrend(); }
};

window.onError = function (message) {
    showToast(message, 'error');
};

// 启动时 C# 下发：上次保存的连接参数 + 本机可用串口列表
window.onInitConfig = function (msg) {
    if (!msg) return;
    var c = msg.connection || {};

    function setVal(id, v) {
        var el = document.getElementById(id);
        if (el && v !== undefined && v !== null) el.value = v;
    }

    setVal('inputProtocol', c.protocol);
    setVal('inputIp', c.ip);
    setVal('inputPort', c.port);
    setVal('inputUnit', c.unitId);
    setVal('inputRack', c.rack);
    setVal('inputSlot', c.slot);
    setVal('inputCpu', c.cpu);
    setVal('inputScan', c.scanInterval);
    setVal('inputSerialPort', c.serialPort);
    setVal('inputBaud', c.baudRate);
    setVal('inputDataBits', c.dataBits);
    setVal('inputStopBits', c.stopBits);
    setVal('inputParity', c.parity);
    setVal('inputRawSend', c.sendHex);
    setVal('inputRawPort', c.rawPort);

    // 串口下拉候选（datalist，仍可手动输入）
    var dl = document.getElementById('serialPortList');
    if (dl && Array.isArray(msg.serialPorts)) {
        dl.innerHTML = msg.serialPorts.map(function (p) {
            return '<option value="' + esc(p) + '"></option>';
        }).join('');
    }

    // 回填后同步表单显隐与地址提示
    onProtocolChanged();
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
            case 'initConfig':        window.onInitConfig(msg); break;
            case 'serialPortsChanged': window.onSerialPortsChanged(msg.serialPorts); break;
            case 'windowMetrics':     window.onWindowMetrics(msg); break;
            case 'toast':             showToast(msg.text, msg.kind || 'info'); break;
            case 'error':             showToast(msg.text, 'error'); break;
            default: break;
        }
    });
}

function isModbusProtocol(p) {
    return p === 'ModbusTcp' || p === 'ModbusRtu';
}

function connectPlc() {
    var protocol = currentProtocol();
    var isRtu = protocol === 'ModbusRtu';
    var isRaw = protocol === 'RawTcp';
    var ip = document.getElementById('inputIp').value.trim();
    var scanInterval = parseInt(document.getElementById('inputScan').value) || 500;

    // 串口协议没有 IP，无需校验；其余协议校验 IP 格式
    if (!isRtu) {
        if (!ip) {
            showToast('请先填写设备 IP 地址', 'error');
            document.getElementById('inputIp').focus();
            return;
        }
        if (/[^0-9a-zA-Z.\-:]/.test(ip)) {
            showToast('IP 地址格式不正确：' + ip, 'error');
            document.getElementById('inputIp').focus();
            return;
        }
    }

    var payload = {
        action: 'connect',
        protocol: protocol,
        scanInterval: scanInterval
    };

    if (protocol === 'ModbusTcp') {
        payload.ip = ip;
        payload.port = parseInt(document.getElementById('inputPort').value) || 502;
        payload.unitId = parseInt(document.getElementById('inputUnit').value) || 1;
    } else if (protocol === 'ModbusRtu') {
        payload.serialPort = document.getElementById('inputSerialPort').value.trim() || 'COM1';
        payload.baudRate = parseInt(document.getElementById('inputBaud').value) || 9600;
        payload.dataBits = parseInt(document.getElementById('inputDataBits').value) || 8;
        payload.stopBits = document.getElementById('inputStopBits').value;
        payload.parity = document.getElementById('inputParity').value;
        payload.unitId = parseInt(document.getElementById('inputRtuUnit').value) || 1;
    } else if (protocol === 'RawTcp') {
        payload.ip = ip;
        payload.port = parseInt(document.getElementById('inputRawPort').value) || 5000;
        payload.sendHex = document.getElementById('inputRawSend').value.trim();
    } else {
        payload.ip = ip;
        payload.rack = parseInt(document.getElementById('inputRack').value) || 0;
        payload.slot = parseInt(document.getElementById('inputSlot').value) || 1;
        payload.cpu = document.getElementById('inputCpu').value;
    }

    // 侧边栏标题同步显示实际连接的地址（串口协议显示串口号，之前一直写死 192.168.0.1）
    var connIp = document.getElementById('connIp');
    if (connIp) connIp.textContent = isRtu ? payload.serialPort : payload.ip;

    postToCSharp(payload);
}

// ── 协议切换 ──────────────────────────────────────────────────
function currentProtocol() {
    var el = document.getElementById('inputProtocol');
    return el ? el.value : 'S7';
}

function showField(id, visible) {
    var el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
}

function onProtocolChanged() {
    var protocol = currentProtocol();
    var isS7 = protocol === 'S7';
    var isModbus = protocol === 'ModbusTcp';
    var isRtu = protocol === 'ModbusRtu';
    var isRaw = protocol === 'RawTcp';

    // 连接表单：按协议只显示相关参数（串口协议没有 IP）
    showField('ipField', !isRtu);
    showField('s7Fields', isS7);
    showField('modbusFields', isModbus);
    showField('serialFields', isRtu);
    showField('rawFields', isRaw);

    // 侧边栏信息卡：显示当前协议对应的设置提示
    showField('tiaCard', isS7);
    showField('modbusCard', isModbus);
    showField('rtuCard', isRtu);
    showField('rawCard', isRaw);

    // 标签地址输入提示随协议变化
    var addr = document.getElementById('editorAddress');
    if (addr) {
        addr.placeholder = (isModbus || isRtu)
            ? (currentLanguage === 'en-US' ? 'e.g. HR100 / 40001 / CO0' : '例如：HR100 / 40001 / CO0')
            : isRaw
                ? (currentLanguage === 'en-US' ? 'e.g. 0 (response byte offset)' : '例如：0（响应字节偏移）')
                : (currentLanguage === 'en-US' ? 'e.g. DB1.DBW2' : '例如：DB1.DBW2');
    }
    var preview = document.getElementById('editorPreview');
    if (preview) {
        preview.textContent = currentLanguage === 'en-US' ? 'Address will be parsed automatically…' : '输入地址后自动解析…';
        preview.className = 'field-preview';
    }

    // 通知 C# 侧当前协议，新增/编辑标签时按此选择地址解析器
    postToCSharp({ action: 'setProtocol', protocol: protocol });
}

// Modbus / 原始 TCP 区域名（中英自适应）
function areaLabel(a) {
    if (currentLanguage === 'en-US') {
        if (a === 'HR') return 'Holding reg (4x)';
        if (a === 'IR') return 'Input reg (3x)';
        if (a === 'CO') return 'Coil (0x)';
        if (a === 'DI') return 'Discrete input (1x)';
        if (a === 'RawData') return 'Raw data';
        return a;
    }
    if (a === 'HR') return '保持寄存器(4x)';
    if (a === 'IR') return '输入寄存器(3x)';
    if (a === 'CO') return '线圈(0x)';
    if (a === 'DI') return '离散输入(1x)';
    if (a === 'RawData') return '原始数据';
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
    var safeInset = inset > 50 ? inset : 138;
    var finalW = safeInset + 16;
    document.documentElement.style.setProperty('--winctl-w', finalW + 'px');
};

function onToolbarStatusClick() {
    if (state.connected) {
        disconnectPlc();
    } else {
        connectPlc();
    }
}

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

function importTagsCsv() {
    postToCSharp({ action: 'importTags' });
}

function exportTagsCsv() {
    postToCSharp({ action: 'exportTags' });
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

    if (statusText !== undefined && statusText !== null) {
        state.statusText = statusText;
    }
    var rawText = (statusText !== undefined && statusText !== null) ? statusText : state.statusText;
    connecting = !!connecting;
    var defaultStatus = connecting ? '连接中…' : (connected ? '已连接' : '未连接');
    var label = t(rawText || defaultStatus);
    var failed = !connected && !connecting && /失败|fail/i.test(label);

    // Toggle connected / connecting classes (amber pulse while attempting)
    if (header) {
        header.classList.toggle('connected', connected);
        header.classList.toggle('connecting', connecting);
    }
    if (led) {
        led.classList.toggle('connected', connected);
        led.classList.toggle('connecting', connecting);
    }
    if (statusEl) {
        statusEl.classList.toggle('connected', connected);
        statusEl.textContent = label;
        statusEl.title = label;
    }
    if (statusDot) {
        statusDot.classList.toggle('connected', connected);
        statusDot.classList.toggle('connecting', connecting);
    }
    if (toolbarDot) {
        toolbarDot.classList.toggle('connected', connected);
        toolbarDot.classList.toggle('connecting', connecting);
    }

    // 顶部工具栏圆点呼吸指示灯悬停提示与状态
    if (toolbarPill) {
        toolbarPill.classList.toggle('is-connected', connected);
        toolbarPill.classList.toggle('is-connecting', connecting);
        toolbarPill.classList.toggle('is-failed', failed);
        var ipHint = state.ip ? ' (' + state.ip + ')' : '';
        var fullTitle = label + ipHint;
        toolbarPill.title = fullTitle;
        toolbarPill.setAttribute('aria-label', fullTitle);
    }

    // Status text
    if (toolbarText) toolbarText.textContent = label;
    if (statusTextEl) statusTextEl.textContent = label;

    // Statusbar left parent
    var sbl = document.querySelector('.sb-left');
    if (sbl) {
        sbl.classList.toggle('connected', connected);
        sbl.classList.toggle('connecting', connecting);
    }

    // Button visibility + disable Connect while an attempt is in flight
    if (btnConnToolbar) {
        btnConnToolbar.style.display = connected ? 'none' : '';
        btnConnToolbar.disabled = connecting;
    }
    if (btnDisconnToolbar) {
        btnDisconnToolbar.style.display = connected ? '' : 'none';
    }
    if (btnConnSidebar) {
        btnConnSidebar.style.display = connected ? 'none' : '';
        btnConnSidebar.disabled = connecting;
    }
    if (btnDisconnSidebar) {
        btnDisconnSidebar.style.display = connected ? '' : 'none';
    }

    // 连接按钮在尝试期间显示"连接中…"，给出明确的进行中反馈
    var btnConnSidebarLabel = btnConnSidebar ? btnConnSidebar.querySelector('.btn-label') : null;
    if (btnConnSidebarLabel) btnConnSidebarLabel.textContent = connecting ? (currentLanguage === 'en-US' ? 'Connecting…' : '连接中…') : (currentLanguage === 'en-US' ? 'Connect PLC' : '连接 PLC');
    var btnConnToolbarLabel = btnConnToolbar ? btnConnToolbar.querySelector('.btn-label') : null;
    if (btnConnToolbarLabel) btnConnToolbarLabel.textContent = connecting ? (currentLanguage === 'en-US' ? 'Connecting…' : '连接中…') : (currentLanguage === 'en-US' ? 'Connect' : '连接');

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
    if (statusTagEl) statusTagEl.textContent = (currentLanguage === 'en-US' ? 'Tags: ' : '标签: ') + count;
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
        state.dashValEls[i].title = tagValueTitle(tag);

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
            el.title = tagValueTitle(tag);
            if (el.textContent !== newVal) {
                el.textContent = newVal;
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

        var grpDisplay = tag.group ? (tag.group === 'Default' ? (currentLanguage === 'en-US' ? 'Default' : '默认') : tag.group) : (currentLanguage === 'en-US' ? 'Default' : '默认');
        tr.innerHTML =
            '<td>' +
                '<div class="cell-name">' +
                    '<span class="scan-dot ' + (tag.scanEnabled ? 'on' : 'off') + '"></span>' +
                    '<span class="area-dot" style="background:' + aColor + '"></span>' +
                    '<span class="name-text" title="' + esc(tag.name) + '">' + esc(tag.name) + '</span>' +
                '</div>' +
            '</td>' +
            '<td class="cell-address" title="' + esc(tag.address) + '">' + esc(tag.address) + '</td>' +
            '<td><span class="group-badge">' + esc(grpDisplay) + '</span></td>' +
            '<td><span class="type-badge" style="background:' + hexToRgba(tColor, 0.15) + ';color:' + tColor + '">' + esc(tag.dataType) + '</span></td>' +
            '<td><span class="cell-value ' + valueClass + '">' + esc(formatValue(tag.value, tag.quality)) + '</span></td>' +
            '<td><span class="quality-badge ' + qualityClass + '">' + qualityLabel(tag.quality) + '</span></td>' +
            '<td class="cell-time">' + esc(tag.timestamp || '--') + '</td>';

        // Cache element refs for fast per-scan updates
        state.tblValEls[i] = tr.querySelector('.cell-value');
        state.tblValEls[i].title = formatValueFull(tag.value, tag.quality);
        state.tblQBadges[i] = tr.querySelector('.quality-badge');
        updateQualityTooltip(state.tblQBadges[i], tag);
        state.tblTimeEls[i] = tr.querySelector('.cell-time');

        tbody.appendChild(tr);
    }

    if (visible === 0) {
        var trEmpty = document.createElement('tr');
        trEmpty.innerHTML = '<td colspan="7" class="no-results">' + (currentLanguage === 'en-US' ? 'No tags match the filter criteria' : '没有符合筛选条件的标签') + '</td>';
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
            updateQualityTooltip(qBadge, tag);
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
    var html = '<option value="All">' + (currentLanguage === 'en-US' ? 'All groups' : '全部分组') + '</option>';
    var found = false;
    for (var k = 0; k < keys.length; k++) {
        var selAttr = keys[k] === current ? ' selected' : '';
        if (selAttr) found = true;
        var displayKey = keys[k] === 'Default' ? (currentLanguage === 'en-US' ? 'Default' : '默认') : keys[k];
        html += '<option value="' + esc(keys[k]) + '"' + selAttr + '>' + esc(displayKey) + '</option>';
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

function tagErrorMessage(tag) {
    return tag && tag.quality === 'Bad' ? (tag.errorMessage || (currentLanguage === 'en-US' ? 'Read failed' : '读取失败')) : '';
}

function tagValueTitle(tag) {
    var value = formatValueFull(tag.value, tag.quality);
    var error = tagErrorMessage(tag);
    return error ? value + ' · ' + error : value;
}

function updateQualityTooltip(el, tag) {
    if (!el) return;
    var error = tagErrorMessage(tag);
    el.title = error;
    el.setAttribute('aria-label', qualityLabel(tag.quality) + (error ? '：' + error : ''));
}

function qualityLabel(q) {
    if (currentLanguage === 'en-US') {
        if (q === 'Good') return 'Good';
        if (q === 'Bad') return 'Fault';
        return 'Unknown';
    }
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
    if (toggleText) toggleText.textContent = tag.scanEnabled ? (currentLanguage === 'en-US' ? 'Disable scanning' : '停用扫描') : (currentLanguage === 'en-US' ? 'Enable scanning' : '启用扫描');

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
        var msg = currentLanguage === 'en-US'
            ? 'Delete tag "' + state.tags[idx].name + '"?'
            : '确定删除标签「' + state.tags[idx].name + '」？';
        if (confirm(msg)) {
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
        err.textContent = translateText(message || '', currentLanguage);
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
    document.getElementById('tagEditorTitle').textContent = currentLanguage === 'en-US' ? 'Add tag' : '添加标签';
    document.getElementById('editorName').value = '';
    document.getElementById('editorAddress').value = '';
    document.getElementById('editorDataType').value = 'Bool';
    document.getElementById('editorGroup').value = 'Default';
    document.getElementById('editorComment').value = '';
    document.getElementById('editorScale').value = '1';
    document.getElementById('editorOffset').value = '0';
    document.getElementById('editorScanEnabled').checked = true;
    clearEditorErrors();
    var preview = document.getElementById('editorPreview');
    preview.textContent = currentLanguage === 'en-US' ? 'Address will be parsed automatically…' : '输入地址后自动解析…';
    preview.className = 'field-preview';
    document.getElementById('tagEditorModal').classList.add('visible');
    document.getElementById('editorName').focus();
}

function showEditTagModal(index) {
    var tag = state.tags[index];
    if (!tag) return;

    state.editingTagIndex = index;
    state.editorTypeTouched = true; // 编辑已有标签：保留原数据类型，不被地址后缀覆盖
    document.getElementById('tagEditorTitle').textContent = currentLanguage === 'en-US' ? 'Edit tag' : '编辑标签';
    document.getElementById('editorName').value = tag.name;
    document.getElementById('editorAddress').value = tag.address;
    document.getElementById('editorDataType').value = tag.dataType;
    document.getElementById('editorGroup').value = tag.group;
    document.getElementById('editorComment').value = tag.comment || '';
    document.getElementById('editorScale').value = (tag.scale === undefined || tag.scale === null) ? '1' : String(tag.scale);
    document.getElementById('editorOffset').value = (tag.offset === undefined || tag.offset === null) ? '0' : String(tag.offset);
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
    var duplicateName = state.tags.some(function (tag, index) {
        return index !== state.editingTagIndex &&
            String(tag.name || '').trim().toLowerCase() === name.toLowerCase();
    });
    if (duplicateName) {
        setFieldError('editorName', 'editorNameError', '标签名称已存在，请使用唯一名称');
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

    var scaleVal = parseFloat(document.getElementById('editorScale').value);
    var offsetVal = parseFloat(document.getElementById('editorOffset').value);
    var tag = {
        name: name,
        address: address,
        dataType: dataType,
        group: group,
        comment: comment,
        scanEnabled: scanEnabled,
        // 缩放为 0 或非法值时回退 1（0 会让所有显示恒等于偏移量，无意义）
        scale: (isNaN(scaleVal) || scaleVal === 0) ? 1 : scaleVal,
        offset: isNaN(offsetVal) ? 0 : offsetVal
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
        preview.textContent = currentLanguage === 'en-US' ? 'Address will be parsed automatically…' : '输入地址后自动解析…';
        preview.className = 'field-preview';
        return;
    }

    var parsed = parseAddress(addr);
    if (parsed) {
        var text;
        var aLabel = areaLabel(parsed.area);
        if (parsed.modbus) {
            text = (currentLanguage === 'en-US' ? 'Area: ' : '区域: ') + aLabel +
                   (currentLanguage === 'en-US' ? '   |   Type: ' : '   |   类型: ') + parsed.dataType +
                   (currentLanguage === 'en-US' ? '   |   Register: ' : '   |   寄存器地址: ') + parsed.byteOffset;
        } else if (parsed.raw) {
            text = (currentLanguage === 'en-US' ? 'Area: ' : '区域: ') + aLabel +
                   (currentLanguage === 'en-US' ? '   |   Type: ' : '   |   类型: ') + parsed.dataType +
                   (currentLanguage === 'en-US' ? '   |   Byte offset: ' : '   |   字节偏移: ') + parsed.byteOffset;
        } else {
            text = (currentLanguage === 'en-US' ? 'Area: ' : '区域: ') + parsed.area +
                   (currentLanguage === 'en-US' ? '   |   Type: ' : '   |   类型: ') + parsed.dataType +
                   (currentLanguage === 'en-US' ? '   |   Byte offset: ' : '   |   字节偏移: ') + parsed.byteOffset;
            if (parsed.dataType === 'Bool') text += (currentLanguage === 'en-US' ? '   |   Bit: ' : '   |   位: ') + parsed.bitOffset;
        }
        preview.textContent = text;
        preview.className = 'field-preview valid';
        // 仅当用户没有手动选过类型时才用地址后缀联动下拉
        if (!state.editorTypeTouched) {
            document.getElementById('editorDataType').value = parsed.dataType;
        }
    } else {
        preview.textContent = currentLanguage === 'en-US' ? 'Unable to parse this address. Check the format.' : '无法解析该地址，请检查格式';
        preview.className = 'field-preview invalid';
        document.getElementById('editorAddress').classList.add('invalid');
    }
}

// 按当前协议选择解析器
function parseAddress(addr) {
    var p = currentProtocol();
    if (isModbusProtocol(p)) return parseModbusAddress(addr);
    if (p === 'RawTcp') return parseRawAddress(addr);
    return parseS7Address(addr);
}

// 原始 TCP 地址解析：地址即响应数据中的字节偏移
function parseRawAddress(addr) {
    if (!/^\d+$/.test(addr)) return null;
    var offset = parseInt(addr, 10);
    if (offset > 65535) return null;
    return { area: 'RawData', dataType: 'Word', dbNumber: 0, byteOffset: offset, bitOffset: 0, raw: true };
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
    document.getElementById('writeTagCurrent').textContent = (currentLanguage === 'en-US' ? 'Current value: ' : '当前值: ') + formatValue(tag.value, tag.quality);
    clearFieldError('writeValueInput', 'writeValueError');

    var input = document.getElementById('writeValueInput');
    input.value = '';
    input.placeholder = writePlaceholder(tag.dataType);
    document.getElementById('writeValueModal').classList.add('visible');
    input.focus();
}

// 按数据类型给出输入提示与取值范围
function writePlaceholder(dataType) {
    if (currentLanguage === 'en-US') {
        switch (dataType) {
            case 'Bool':  return 'true / false (or 1 / 0)';
            case 'Byte':  return '0 ~ 255, 0x1F supported';
            case 'Word':  return '0 ~ 65535, 0xFFFF supported';
            case 'DWord': return '0 ~ 4294967295, 0xFFFFFFFF supported';
            case 'Int':   return '-32768 ~ 32767';
            case 'DInt':  return '-2147483648 ~ 2147483647';
            case 'Real':  return 'Float, e.g. 12.5';
            default:      return 'Enter a value';
        }
    }
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
        case 'Byte':  return (value < 0 || value > 255) ? t('Byte 取值范围 0 ~ 255') : '';
        case 'Word':  return (value < 0 || value > 65535) ? t('Word 取值范围 0 ~ 65535') : '';
        case 'DWord': return (value < 0 || value > 4294967295) ? t('DWord 取值范围 0 ~ 4294967295') : '';
        case 'Int':   return (value < -32768 || value > 32767) ? t('Int 取值范围 -32768 ~ 32767') : '';
        case 'DInt':  return (value < -2147483648 || value > 2147483647) ? t('DInt 取值范围 -2147483648 ~ 2147483647') : '';
        default:      return '';
    }
}

// ── Window Drag ───────────────────────────────────────────────
// 原生标题栏负责拖动窗口，无需自定义处理。

// ── 自定义下拉（规避原生 <select> 弹层定位错乱）───────────────
// 原生 <select> 的展开列表由浏览器以独立弹窗渲染，在 WebView2（高 DPI）宿主里
// 会与控件错位 —— 列表飘到控件右下方、覆盖到别的表单行上。
// 这里保留原生 <select> 作为取值与显示的唯一来源（.value / options 变化会自动反映），
// 另外叠一层透明点击层，点击时打开一个"页内浮层"（fixed 定位、跟随控件），
// 彻底绕开宿主弹窗的定位问题。键盘（Enter/Space/方向键/Esc）同样可用。

var ddMenu = null;
var ddActiveHit = null;
var ddGlobalListenersReady = false;

function ensureDdMenu() {
    if (ddMenu) return ddMenu;
    ddMenu = document.createElement('div');
    ddMenu.className = 'dd-menu';
    ddMenu.setAttribute('role', 'listbox');
    document.body.appendChild(ddMenu);
    return ddMenu;
}

function closeDdMenu() {
    if (ddMenu) ddMenu.classList.remove('visible');
    if (ddActiveHit) ddActiveHit.setAttribute('aria-expanded', 'false');
    ddActiveHit = null;
}

function openDdMenu(hit, sel) {
    var menu = ensureDdMenu();
    menu.innerHTML = '';

    var opts = sel.options;
    for (var i = 0; i < opts.length; i++) {
        (function (opt) {
            var item = document.createElement('div');
            item.className = 'dd-item' + (opt.selected ? ' active' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
            item.textContent = opt.text;
            item.addEventListener('click', function () {
                if (sel.value !== opt.value) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
                closeDdMenu();
                hit.focus();
            });
            menu.appendChild(item);
        })(opts[i]);
    }

    // 先按控件宽度显示出来，再量高度以决定向上 / 向下展开
    var r = hit.getBoundingClientRect();
    menu.style.width = r.width + 'px';
    menu.style.left = '-9999px';
    menu.style.top = '0px';
    menu.classList.add('visible');

    var mh = menu.offsetHeight;
    var below = window.innerHeight - r.bottom - 8;
    var top = (mh + 8 <= below || r.top < mh + 8) ? r.bottom + 4 : r.top - mh - 4;
    if (top < 4) top = 4;
    var left = Math.max(4, Math.min(r.left, window.innerWidth - r.width - 4));

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    ddActiveHit = hit;
    hit.setAttribute('aria-expanded', 'true');

    // 让当前选中项居中显示；只滚动菜单自身，避免 scrollIntoView 连带滚动其它容器
    var act = menu.querySelector('.dd-item.active');
    if (act) menu.scrollTop = Math.max(0, act.offsetTop - menu.clientHeight / 2 + act.offsetHeight / 2);
}

// 键盘高亮在当前项之间移动（用 .kb 类，与"已选中"的 .active 区分）
function moveDdActive(delta) {
    if (!ddMenu) return;
    var items = ddMenu.querySelectorAll('.dd-item');
    if (!items.length) return;
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
        if (items[i].classList.contains('kb')) { idx = i; break; }
    }
    if (idx < 0) {
        for (var k = 0; k < items.length; k++) {
            if (items[k].classList.contains('active')) { idx = k; break; }
        }
    }
    idx = idx < 0 ? 0 : Math.max(0, Math.min(items.length - 1, idx + delta));
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('kb', j === idx);
    var it = items[idx];
    if (it.offsetTop < menu.scrollTop) menu.scrollTop = it.offsetTop;
    else if (it.offsetTop + it.offsetHeight > menu.scrollTop + menu.clientHeight)
        menu.scrollTop = it.offsetTop + it.offsetHeight - menu.clientHeight;
}

function initCustomSelect(sel) {
    if (sel.dataset.ddDone === '1') return;
    sel.dataset.ddDone = '1';

    // 原生 select 退居幕后：只负责显示当前值，不再接受指针 / 焦点
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');

    var wrap = document.createElement('div');
    wrap.className = 'dd-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    var hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'dd-hit';
    hit.setAttribute('aria-haspopup', 'listbox');
    hit.setAttribute('aria-expanded', 'false');
    var lab = sel.id ? document.querySelector('label[for="' + sel.id + '"]') : null;
    var name = (lab && lab.textContent.trim()) || sel.getAttribute('aria-label') || sel.getAttribute('title') || '下拉选择';
    hit.setAttribute('aria-label', name);
    wrap.appendChild(hit);

    hit.addEventListener('click', function (e) {
        e.preventDefault();
        if (ddActiveHit === hit) { closeDdMenu(); return; }
        closeDdMenu();
        openDdMenu(hit, sel);
    });

    hit.addEventListener('keydown', function (e) {
        var isOpen = ddActiveHit === hit;
        if (e.key === 'Escape') {
            if (isOpen) { closeDdMenu(); e.preventDefault(); }
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) openDdMenu(hit, sel);
            else moveDdActive(e.key === 'ArrowDown' ? 1 : -1);
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isOpen) { openDdMenu(hit, sel); return; }
            var pick = ddMenu.querySelector('.dd-item.kb') || ddMenu.querySelector('.dd-item.active');
            if (pick) pick.click();
        }
    });
}

function initCustomSelects(root) {
    root = root || document;
    var list = root.querySelectorAll('select.field-input');
    for (var i = 0; i < list.length; i++) initCustomSelect(list[i]);

    if (ddGlobalListenersReady) return;
    ddGlobalListenersReady = true;

    // 点击别处 / 滚动 / 改变窗口大小即收起
    document.addEventListener('click', function (e) {
        if (!ddActiveHit) return;
        if (ddActiveHit.contains(e.target)) return;
        if (ddMenu && ddMenu.contains(e.target)) return;
        closeDdMenu();
    });
    window.addEventListener('resize', closeDdMenu);
    window.addEventListener('scroll', function (e) {
        if (ddMenu && ddMenu.contains(e.target)) return;
        closeDdMenu();
    }, true);
}

// ── DOM Ready Bindings ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btnTheme').addEventListener('click', toggleTheme);

    var btnSidebar = document.getElementById('btnSidebar');
    if (btnSidebar) btnSidebar.addEventListener('click', toggleSidebar);

    var protocolSelect = document.getElementById('inputProtocol');
    if (protocolSelect) protocolSelect.addEventListener('change', function () {
        if (this.value === 'ModbusRtu') refreshSerialPorts();
    });

    // 协议相关 UI 初始化（默认 S7），并通知 C# 侧当前协议
    onProtocolChanged();

    // 把所有 <select class="field-input"> 换成自定义下拉（规避原生弹层错位）
    initCustomSelects();

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
        closeDdMenu();
        hideContextMenu();
        if (document.getElementById('widgetProps').classList.contains('visible')) {
            closeWidgetProps();
        }
        if (document.getElementById('tagEditorModal').classList.contains('visible')) {
            closeTagEditor();
        }
        if (document.getElementById('writeValueModal').classList.contains('visible')) {
            closeWriteValue();
        }
        if (document.getElementById('aboutModal').classList.contains('visible')) {
            closeAbout();
        }
        var sModal = document.getElementById('settingsModal');
        if (sModal && sModal.classList.contains('visible')) {
            closeSettings();
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
    // 如果属性浮窗可见，点击浮窗外侧时关闭；但当点击页面 body 层级的自定义下拉菜单（ddMenu）时
    // 不应被视为"点击浮窗外部"，因此做兼容判断，避免误关掉属性面板。
    var props = document.getElementById('widgetProps');
    if (props && props.classList.contains('visible') && !props.contains(e.target) &&
        !(ddMenu && ddMenu.contains(e.target))) {
        closeWidgetProps();
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
document.getElementById('widgetProps').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeWidgetProps();
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
    document.getElementById('trendView').style.display = view === 'trend' ? 'flex' : 'none';
    document.getElementById('btnViewTable').classList.toggle('active', view === 'table');
    document.getElementById('btnViewScreens').classList.toggle('active', view === 'screens');
    document.getElementById('btnViewTrend').classList.toggle('active', view === 'trend');
    // 切到画面视图时立即刷新一次组件值，避免显示上一次扫描的旧值
    if (view === 'screens') updateScreenWidgets();
    if (view === 'trend') { renderTrendTagList(); drawTrend(); }
}

// ── 历史趋势 ────────────────────────────────────────────────
// 前端内存缓冲：只采集已选曲线，并限制实际时间范围和最大点数。
var HISTORY_MAX = 12000;
var TREND_MAX_TAGS = 6;
var TREND_HISTORY_MS = 600000;
var trendWindowMs = 600000;
var trendCursor = null;
var trendPlot = null;
// 曲线配色（与区域色无关，保证多线可区分；明暗主题下对比度均可读）
var TREND_COLORS = ['#2f6fe4', '#16a34a', '#d97706', '#dc2626', '#9333ea', '#0f766e'];

// state.history: { tagIndex: [{t: epochMs, v: number}] }
if (!state.history) state.history = {};
// state.trendSel: 勾选的标签索引数组（保持勾选顺序 = 配色顺序）
if (!state.trendSel) state.trendSel = [];

document.getElementById('trendRange').addEventListener('change', function () {
    trendWindowMs = Number(this.value) || 600000;
    drawTrend();
});

function recordHistory(results) {
    var now = Date.now();
    var cutoff = now - TREND_HISTORY_MS;
    var trendTags = state.trendSel.slice();
    var screen = state.screens[state.currentScreen];
    if (screen) {
        screen.widgets.forEach(function (widget) {
            if (widget.type !== 'trend' || !widget.tag) return;
            var idx = findTagIndex(widget.tag);
            if (idx >= 0 && trendTags.indexOf(idx) < 0) trendTags.push(idx);
        });
    }
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (trendTags.indexOf(r.index) < 0 || r.quality !== 'Good' || typeof r.value !== 'number') continue;
        var buf = state.history[r.index];
        if (!buf) buf = state.history[r.index] = [];
        buf.push({ t: now, v: r.value });
        var expired = 0;
        while (expired < buf.length && buf[expired].t < cutoff) expired++;
        if (expired > 0) buf.splice(0, expired);
        if (buf.length > HISTORY_MAX) buf.splice(0, buf.length - HISTORY_MAX);
    }
}

function renderTrendTagList() {
    var list = document.getElementById('trendTagList');
    if (!list) return;
    document.getElementById('btnClearTrendSelection').disabled = state.trendSel.length === 0;
    document.getElementById('btnClearTrendHistory').disabled = state.trendSel.length === 0;
    list.innerHTML = '';
    for (var i = 0; i < state.tags.length; i++) {
        (function (idx) {
            var tag = state.tags[idx];
            var numeric = tag.dataType !== 'Bool';
            var item = document.createElement('label');
            item.className = 'trend-tag-item' + (numeric ? '' : ' disabled');
            var selIdx = state.trendSel.indexOf(idx);
            var color = selIdx >= 0 ? TREND_COLORS[selIdx % TREND_COLORS.length] : 'transparent';
            item.innerHTML =
                '<input type="checkbox" data-idx="' + idx + '"' + (selIdx >= 0 ? ' checked' : '') + (numeric ? '' : ' disabled') + '>' +
                '<span class="trend-tag-color" style="background:' + color + '"></span>' +
                '<span class="trend-tag-name" title="' + esc(tag.name) + ' · ' + esc(tag.address) + '">' + esc(tag.name) + '</span>' +
                '<span class="trend-tag-type">' + esc(tag.dataType) + '</span>';
            if (numeric) {
                item.querySelector('input').addEventListener('change', function () { toggleTrendTag(idx); });
            } else {
                item.title = 'Bool 类型不绘制趋势';
            }
            list.appendChild(item);
        })(i);
    }
}

function toggleTrendTag(idx) {
    var at = state.trendSel.indexOf(idx);
    if (at >= 0) {
        state.trendSel.splice(at, 1);
        delete state.history[idx];
    }
    else {
        if (state.trendSel.length >= TREND_MAX_TAGS) {
            showToast('最多同时显示 ' + TREND_MAX_TAGS + ' 条曲线', 'error');
            renderTrendTagList();
            return;
        }
        delete state.history[idx];
        state.trendSel.push(idx);
    }
    renderTrendTagList();
    drawTrend();
}

function clearTrendSelection() {
    for (var i = 0; i < state.trendSel.length; i++) delete state.history[state.trendSel[i]];
    state.trendSel = [];
    renderTrendTagList();
    drawTrend();
}

function clearTrendHistory() {
    if (state.trendSel.length === 0) return;
    for (var i = 0; i < state.trendSel.length; i++) delete state.history[state.trendSel[i]];
    drawTrend();
    showToast('已清除所选曲线历史', 'success');
}

function drawTrend() {
    var canvas = document.getElementById('trendCanvas');
    var empty = document.getElementById('trendEmpty');
    if (!canvas) return;

    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 10 || h < 10) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 收集显示时间范围内有数据的序列
    var series = [];
    var tMax = 0;
    for (var ti = 0; ti < state.trendSel.length; ti++) {
        var selectedHistory = state.history[state.trendSel[ti]];
        if (selectedHistory && selectedHistory.length > 0) {
            tMax = Math.max(tMax, selectedHistory[selectedHistory.length - 1].t);
        }
    }
    if (tMax === 0) tMax = Date.now();
    var tMin = tMax - trendWindowMs;
    for (var i = 0; i < state.trendSel.length; i++) {
        var idx = state.trendSel[i];
        var buf = state.history[idx];
        if (buf && buf.length > 0) {
            var first = 0, last = buf.length;
            while (first < last) {
                var mid = (first + last) >> 1;
                if (buf[mid].t < tMin) first = mid + 1;
                else last = mid;
            }
            var visible = buf.slice(first);
            if (visible.length > 0) {
                series.push({ idx: idx, buf: visible, color: TREND_COLORS[i % TREND_COLORS.length] });
            }
        }
    }

    if (series.length === 0) {
        trendPlot = null;
        hideTrendTooltip();
        if (empty) {
            empty.style.display = '';
            document.getElementById('trendEmptyTitle').textContent = state.trendSel.length ? t('正在采集趋势数据') : t('历史趋势');
            document.getElementById('trendEmptyDesc').textContent = state.trendSel.length
                ? t('所选标签出现有效数值后，曲线将显示在图表中')
                : t('勾选左侧标签后开始采样，最多保留最近 10 分钟数据');
        }
        return;
    }
    if (empty) empty.style.display = 'none';

    // 全局时间窗与值域
    var vMin = Infinity, vMax = -Infinity;
    for (var s = 0; s < series.length; s++) {
        var b = series[s].buf;
        for (var p = 0; p < b.length; p++) {
            if (b[p].v < vMin) vMin = b[p].v;
            if (b[p].v > vMax) vMax = b[p].v;
        }
    }
    if (vMax - vMin < 1e-9) { vMax += 0.5; vMin -= 0.5; }
    var vPad = (vMax - vMin) * 0.08;
    vMin -= vPad; vMax += vPad;

    var css = getComputedStyle(document.documentElement);
    var cGrid = css.getPropertyValue('--overlay').trim() || '#e2e6ec';
    var cText = css.getPropertyValue('--text-3').trim() || '#6b7480';

    var padL = 56, padR = 12, padT = 10, padB = 22;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    function x(t) { return padL + (t - tMin) / (tMax - tMin) * plotW; }
    function y(v) { return padT + (1 - (v - vMin) / (vMax - vMin)) * plotH; }
    trendPlot = { series: series, tMin: tMin, tMax: tMax, padL: padL, padR: padR, padT: padT, padB: padB, plotW: plotW, plotH: plotH, w: w, h: h, x: x, y: y };

    // 网格 + Y 轴刻度（5 档）
    ctx.strokeStyle = cGrid;
    ctx.fillStyle = cText;
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
        var vv = vMin + (vMax - vMin) * g / 4;
        var yy = y(vv);
        ctx.beginPath();
        ctx.moveTo(padL, yy);
        ctx.lineTo(w - padR, yy);
        ctx.stroke();
        ctx.fillText(formatTrendNum(vv), padL - 6, yy);
    }

    // X 轴时间刻度（4 档，HH:MM:SS）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var gx = 0; gx <= 3; gx++) {
        var tt = tMin + (tMax - tMin) * gx / 3;
        var xx = x(tt);
        ctx.beginPath();
        ctx.moveTo(xx, padT);
        ctx.lineTo(xx, h - padB);
        ctx.stroke();
        var d = new Date(tt);
        var label = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
        ctx.fillText(label, xx, h - padB + 5);
    }

    // 折线
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    for (var si = 0; si < series.length; si++) {
        var ser = series[si];
        ctx.strokeStyle = ser.color;
        ctx.beginPath();
        var bb = ser.buf;
        for (var pi = 0; pi < bb.length; pi++) {
            var px = x(bb[pi].t), py = y(bb[pi].v);
            if (pi === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (bb.length === 1) {
            ctx.fillStyle = ser.color;
            ctx.beginPath();
            ctx.arc(x(bb[0].t), y(bb[0].v), 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawTrendCursor(ctx);
    updateTrendTooltip();
}

function nearestTrendPoint(buf, time) {
    var low = 0, high = buf.length;
    while (low < high) {
        var mid = (low + high) >> 1;
        if (buf[mid].t < time) low = mid + 1;
        else high = mid;
    }
    if (low === 0) return buf[0];
    if (low >= buf.length) return buf[buf.length - 1];
    return time - buf[low - 1].t <= buf[low].t - time ? buf[low - 1] : buf[low];
}

function drawTrendCursor(ctx) {
    if (!trendPlot || !trendCursor || trendCursor.x < trendPlot.padL || trendCursor.x > trendPlot.w - trendPlot.padR) return;
    var time = trendPlot.tMin + (trendCursor.x - trendPlot.padL) / trendPlot.plotW * (trendPlot.tMax - trendPlot.tMin);
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim() || '#6b7480';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(trendCursor.x, trendPlot.padT);
    ctx.lineTo(trendCursor.x, trendPlot.h - trendPlot.padB);
    ctx.stroke();
    ctx.setLineDash([]);
    for (var i = 0; i < trendPlot.series.length; i++) {
        var series = trendPlot.series[i];
        var point = nearestTrendPoint(series.buf, time);
        ctx.fillStyle = series.color;
        ctx.beginPath();
        ctx.arc(trendPlot.x(point.t), trendPlot.y(point.v), 4, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function formatTrendTime(time) {
    var d = new Date(time);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + '.' + ('00' + d.getMilliseconds()).slice(-3);
}

function updateTrendTooltip() {
    var tooltip = document.getElementById('trendTooltip');
    var canvas = document.getElementById('trendCanvas');
    if (!tooltip || !canvas || !trendPlot || !trendCursor || trendCursor.x < trendPlot.padL || trendCursor.x > trendPlot.w - trendPlot.padR) {
        hideTrendTooltip();
        return;
    }

    var time = trendPlot.tMin + (trendCursor.x - trendPlot.padL) / trendPlot.plotW * (trendPlot.tMax - trendPlot.tMin);
    var rows = '<div class="trend-tooltip-time">' + formatTrendTime(time) + '</div>';
    for (var i = 0; i < trendPlot.series.length; i++) {
        var series = trendPlot.series[i];
        var tag = state.tags[series.idx];
        var point = nearestTrendPoint(series.buf, time);
        rows += '<div class="trend-tooltip-row">' +
            '<span class="trend-tooltip-name" style="color:' + series.color + '">● ' + esc(tag ? tag.name : '') + '</span>' +
            '<span class="trend-tooltip-value">' + formatTrendNum(point.v) + '</span>' +
            '<span class="trend-tooltip-sample">' + formatTrendTime(point.t) + '</span>' +
            '</div>';
    }
    tooltip.innerHTML = rows;
    tooltip.style.display = 'block';
    tooltip.setAttribute('aria-hidden', 'false');

    var canvasRect = canvas.getBoundingClientRect();
    var mainRect = canvas.parentElement.getBoundingClientRect();
    var left = canvasRect.left - mainRect.left + trendCursor.x + 12;
    var top = canvasRect.top - mainRect.top + trendCursor.y + 12;
    if (left + tooltip.offsetWidth > mainRect.width - 8) left -= tooltip.offsetWidth + 24;
    if (top + tooltip.offsetHeight > mainRect.height - 8) top -= tooltip.offsetHeight + 24;
    tooltip.style.left = Math.max(8, left) + 'px';
    tooltip.style.top = Math.max(48, top) + 'px';
}

function hideTrendTooltip() {
    var tooltip = document.getElementById('trendTooltip');
    if (!tooltip) return;
    tooltip.style.display = 'none';
    tooltip.setAttribute('aria-hidden', 'true');
}

var trendCursorFrame = false;
var trendCanvas = document.getElementById('trendCanvas');
trendCanvas.addEventListener('mousemove', function (e) {
    var rect = trendCanvas.getBoundingClientRect();
    trendCursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (trendCursorFrame) return;
    trendCursorFrame = true;
    requestAnimationFrame(function () {
        trendCursorFrame = false;
        drawTrend();
    });
});
trendCanvas.addEventListener('mouseleave', function () {
    trendCursor = null;
    hideTrendTooltip();
    drawTrend();
});

function formatTrendNum(v) {
    var av = Math.abs(v);
    if (av >= 10000) return v.toFixed(0);
    if (av >= 100) return v.toFixed(1);
    return v.toFixed(2);
}

window.addEventListener('resize', function () {
    if (state.view === 'trend') drawTrend();
});

// ── 画面 CRUD ────────────────────────────────────────────────
function renderScreens() {
    var tabs = document.getElementById('screenTabs');
    var hasCurrentScreen = state.currentScreen >= 0 && state.currentScreen < state.screens.length;
    var renameButton = document.getElementById('btnRenameScreen');
    var deleteButton = document.getElementById('btnDeleteScreen');
    if (renameButton) renameButton.disabled = !hasCurrentScreen;
    if (deleteButton) deleteButton.disabled = !hasCurrentScreen;

    tabs.innerHTML = '';
    for (var i = 0; i < state.screens.length; i++) {
        (function (idx) {
            var tab = document.createElement('div');
            tab.className = 'screen-tab' + (idx === state.currentScreen ? ' active' : '');
            tab.textContent = state.screens[idx].name;
            tab.title = currentLanguage === 'en-US' ? 'Click to switch · Double-click to rename' : '单击切换 · 双击重命名';
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
    var prefix = currentLanguage === 'en-US' ? 'Screen ' : '画面';
    var n = state.screens.length + 1;
    var name = prefix + n;
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
    if (!screen) return;
    var msg = currentLanguage === 'en-US'
        ? 'Delete screen "' + screen.name + '"?'
        : '确定删除画面「' + screen.name + '」？';
    if (!confirm(msg)) return;
    pushUndo();
    state.screens.splice(state.currentScreen, 1);
    if (state.currentScreen >= state.screens.length) state.currentScreen = state.screens.length - 1;
    state.selectedWidgets = [];
    renderScreens();
    scheduleSaveScreens();
}

// ── 组件 CRUD ────────────────────────────────────────────────
// 组件类型：value / lamp / text / bar / button / rect / gauge / switch / alarm / trend
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
    } else if (type === 'gauge') {
        base.x = 620; base.y = 80; base.w = 150; base.h = 150; base.font = 16;
        base.min = 0; base.max = 100; base.unit = '%'; base.barColor = '#2f6ee0';
    } else if (type === 'switch') {
        base.x = 560; base.y = 260; base.w = 120; base.h = 44; base.font = 14;
        base.label = '开关'; base.onText = 'ON'; base.offText = 'OFF'; base.onColor = '#16a34a';
    } else if (type === 'alarm') {
        base.x = 720; base.y = 260; base.w = 180; base.h = 44; base.font = 14;
        base.label = '报警状态'; base.alarmText = '报警'; base.normalText = '正常'; base.alarmColor = '#dc2626';
    } else if (type === 'trend') {
        base.x = 620; base.y = 300; base.w = 260; base.h = 120; base.font = 12;
        base.min = ''; base.max = ''; base.barColor = '#2f6ee0'; base.unit = '';
    }
    return base;
}

// 组件类型名（中英自适应）
function widgetTypeLabel(type) {
    if (currentLanguage === 'en-US') {
        if (type === 'value') return 'Value';
        if (type === 'lamp') return 'Lamp';
        if (type === 'text') return 'Text';
        if (type === 'bar') return 'Bar';
        if (type === 'button') return 'Button';
        if (type === 'rect') return 'Rectangle';
        if (type === 'gauge') return 'Gauge';
        if (type === 'switch') return 'Switch';
        if (type === 'alarm') return 'Alarm indicator';
        if (type === 'trend') return 'Mini trend';
        return 'Widget';
    }
    if (type === 'value') return '数值';
    if (type === 'lamp') return '指示灯';
    if (type === 'text') return '文本';
    if (type === 'bar') return '棒图';
    if (type === 'button') return '按钮';
    if (type === 'rect') return '矩形';
    if (type === 'gauge') return '仪表';
    if (type === 'switch') return '开关';
    if (type === 'alarm') return '报警指示';
    if (type === 'trend') return '迷你趋势';
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
    } else if (w.type === 'gauge') {
        el.innerHTML = '<div class="widget-gauge-head"><span class="widget-gauge-label"></span><span class="widget-gauge-value"></span></div>' +
            '<svg class="widget-gauge-svg" viewBox="0 0 120 72" aria-hidden="true"><path class="widget-gauge-track" d="M 12 62 A 48 48 0 0 1 108 62"/><path class="widget-gauge-arc" d="M 12 62 A 48 48 0 0 1 108 62"/></svg>' +
            '<div class="widget-gauge-range"><span class="widget-gauge-min"></span><span class="widget-gauge-max"></span></div>' + handle;
    } else if (w.type === 'switch') {
        el.innerHTML = '<span class="widget-switch-label"></span><span class="widget-switch-state"></span>' +
            '<span class="widget-switch-track"><span class="widget-switch-thumb"></span></span>' + handle;
    } else if (w.type === 'alarm') {
        el.innerHTML = '<span class="widget-alarm-dot"></span><span class="widget-alarm-label"></span><span class="widget-alarm-state"></span>' + handle;
    } else if (w.type === 'trend') {
        el.innerHTML = '<div class="widget-trend-head"><span class="widget-trend-label"></span><span class="widget-trend-value"></span></div>' +
            '<svg class="widget-trend-svg" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true"><polyline class="widget-trend-line" fill="none"/></svg>' +
            '<div class="widget-trend-footer"><span class="widget-trend-min"></span><span class="widget-trend-max"></span></div>' + handle;
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
    el.title = tagErrorMessage(tag);

    // 通用样式（背景 / 边框 / 圆角 / 对齐 / 文字色 / 加粗）
    applyWidgetStyle(w, el);

    if (w.type === 'value') {
        var labelEl = el.querySelector('.widget-label');
        if (labelEl) labelEl.textContent = w.label || (tag ? tag.name : (currentLanguage === 'en-US' ? 'Unbound' : '未绑定'));
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
            var lampText = w.label || (tag ? tag.name : (currentLanguage === 'en-US' ? 'Unbound' : '未绑定'));
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
            btn.textContent = w.label || (tag ? tag.name : (currentLanguage === 'en-US' ? 'Button' : '按钮'));
            btn.style.fontSize = (w.font || 14) + 'px';
            btn.style.background = w.btnColor || '';
        }
        el.classList.toggle('widget-button-on', hasValue && (tag.value === true || tag.value === 1));
    } else if (w.type === 'gauge') {
        updateGaugeWidget(w, el, tag, hasValue);
        el.classList.toggle('is-unknown', !hasValue);
    } else if (w.type === 'switch') {
        updateSwitchWidget(w, el, tag, hasValue);
    } else if (w.type === 'alarm') {
        updateAlarmWidget(w, el, tag, hasValue);
    } else if (w.type === 'trend') {
        updateMiniTrendWidget(w, el, tag, hasValue);
    }
}

function widgetRange(w, fallbackMin, fallbackMax) {
    var min = w.min === '' || w.min === null || w.min === undefined ? fallbackMin : Number(w.min);
    var max = w.max === '' || w.max === null || w.max === undefined ? fallbackMax : Number(w.max);
    if (!Number.isFinite(min)) min = fallbackMin;
    if (!Number.isFinite(max) || max <= min) max = min + 1;
    return { min: min, max: max };
}

function updateGaugeWidget(w, el, tag, hasValue) {
    var range = widgetRange(w, 0, 100);
    var value = hasValue && typeof tag.value === 'number' ? tag.value : null;
    var ratio = value === null ? 0 : Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
    var arc = el.querySelector('.widget-gauge-arc');
    var label = el.querySelector('.widget-gauge-label');
    var valueEl = el.querySelector('.widget-gauge-value');
    var minEl = el.querySelector('.widget-gauge-min');
    var maxEl = el.querySelector('.widget-gauge-max');
    if (arc) {
        var length = 151;
        try { length = arc.getTotalLength(); } catch (e) { }
        if (!Number.isFinite(length) || length <= 0) length = 151;
        arc.style.strokeDasharray = length;
        arc.style.strokeDashoffset = length * (1 - ratio);
        arc.style.stroke = w.barColor || '';
    }
    if (label) label.textContent = w.label || (tag ? tag.name : (currentLanguage === 'en-US' ? 'Unbound' : '未绑定'));
    if (valueEl) valueEl.textContent = value === null ? '---' : formatWidgetValue(w, value, tag.quality);
    if (minEl) minEl.textContent = String(range.min);
    if (maxEl) maxEl.textContent = String(range.max);
}

function updateSwitchWidget(w, el, tag, hasValue) {
    var on = hasValue && (tag.value === true || tag.value === 1);
    el.classList.toggle('is-on', on);
    el.classList.toggle('is-unknown', !hasValue);
    var label = el.querySelector('.widget-switch-label');
    var stateEl = el.querySelector('.widget-switch-state');
    if (label) label.textContent = w.label || (tag ? tag.name : (currentLanguage === 'en-US' ? 'Switch' : '开关'));
    if (stateEl) stateEl.textContent = !hasValue ? '—' : on ? (w.onText || 'ON') : (w.offText || 'OFF');
    el.style.setProperty('--widget-switch-on', w.onColor || 'var(--green)');
    el.title = tag ? tagErrorMessage(tag) : (currentLanguage === 'en-US' ? 'Tag unbound' : '未绑定标签');
}

function updateAlarmWidget(w, el, tag, hasValue) {
    var alarm = false;
    if (hasValue) {
        var threshold = Number(w.threshold);
        if (typeof tag.value === 'boolean') alarm = tag.value === (w.alarmWhen !== 'false');
        else if (typeof tag.value === 'number' && w.threshold !== '' && w.threshold !== null && w.threshold !== undefined && Number.isFinite(threshold)) {
            alarm = w.compare === 'lt' ? tag.value < threshold : tag.value >= threshold;
        }
    }
    el.classList.toggle('is-alarm', alarm);
    el.classList.toggle('is-unknown', !hasValue);
    var label = el.querySelector('.widget-alarm-label');
    var status = el.querySelector('.widget-alarm-state');
    if (label) label.textContent = w.label || (tag ? tag.name : (currentLanguage === 'en-US' ? 'Alarm indicator' : '报警指示'));
    if (status) status.textContent = !hasValue ? (currentLanguage === 'en-US' ? 'No data' : '无数据') : alarm ? (w.alarmText || (currentLanguage === 'en-US' ? 'Alarm' : '报警')) : (w.normalText || (currentLanguage === 'en-US' ? 'Normal' : '正常'));
    el.style.setProperty('--widget-alarm-color', w.alarmColor || 'var(--red)');
    el.title = tag ? tagErrorMessage(tag) : (currentLanguage === 'en-US' ? 'Tag unbound' : '未绑定标签');
}

function updateMiniTrendWidget(w, el, tag, hasValue) {
    var label = el.querySelector('.widget-trend-label');
    var current = el.querySelector('.widget-trend-value');
    var line = el.querySelector('.widget-trend-line');
    var minEl = el.querySelector('.widget-trend-min');
    var maxEl = el.querySelector('.widget-trend-max');
    var idx = tag ? findTagIndex(tag.name) : -1;
    var points = idx >= 0 && state.history[idx] ? state.history[idx] : [];
    var vals = points.map(function (p) { return p.v; });
    var range = widgetRange(w, vals.length ? Math.min.apply(null, vals) : 0,
        vals.length ? Math.max.apply(null, vals) : 100);
    if (range.max <= range.min) range.max = range.min + 1;
    if (label) label.textContent = w.label || (tag ? tag.name : (currentLanguage === 'en-US' ? 'Mini trend' : '迷你趋势'));
    if (current) current.textContent = hasValue ? formatWidgetValue(w, tag.value, tag.quality) : '---';
    if (minEl) minEl.textContent = String(range.min);
    if (maxEl) maxEl.textContent = String(range.max);
    if (line) {
        var usable = points.slice(-40);
        var coords = usable.map(function (p, i) {
            var x = usable.length < 2 ? 1 : 1 + i / (usable.length - 1) * 98;
            var y = 2 + (1 - Math.max(0, Math.min(1, (p.v - range.min) / (range.max - range.min)))) * 34;
            return x.toFixed(1) + ',' + y.toFixed(1);
        });
        line.setAttribute('points', coords.join(' '));
        line.style.stroke = w.barColor || '';
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

function propField(label, inner, small, extraClass) {
    return '<div class="prop-field' + (small ? ' prop-field-sm' : '') + (extraClass ? ' ' + extraClass : '') + '">' +
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
        '</span>', true, 'prop-field-color');
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
    return [
        { v: '', t: currentLanguage === 'en-US' ? 'Default' : '默认' },
        { v: 'left', t: currentLanguage === 'en-US' ? 'Left' : '左' },
        { v: 'center', t: currentLanguage === 'en-US' ? 'Center' : '居中' },
        { v: 'right', t: currentLanguage === 'en-US' ? 'Right' : '右' }
    ];
}
function actionOptions() {
    return [
        { v: 'toggle', t: currentLanguage === 'en-US' ? 'Toggle' : '取反' },
        { v: 'set', t: currentLanguage === 'en-US' ? 'Set' : '置位' },
        { v: 'clear', t: currentLanguage === 'en-US' ? 'Reset' : '复位' }
    ];
}
function compareOptions() {
    return [
        { v: 'gte', t: currentLanguage === 'en-US' ? 'Greater or equal (>=)' : '大于等于' },
        { v: 'lt', t: currentLanguage === 'en-US' ? 'Less than (<)' : '小于' }
    ];
}
function alarmWhenOptions() {
    return [
        { v: 'true', t: currentLanguage === 'en-US' ? 'Alarm when True' : '为真时报警' },
        { v: 'false', t: currentLanguage === 'en-US' ? 'Alarm when False' : '为假时报警' }
    ];
}
function tagOptions(current) {
    var html = '<option value=""' + (current ? '' : ' selected') + '>' + (currentLanguage === 'en-US' ? 'Unbound' : '未绑定') + '</option>';
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
    var overlay = document.getElementById('widgetProps');
    var el = document.getElementById('widgetPropsContent');
    var btnDel = document.getElementById('btnDeleteWidget');
    var sel = getSelectedWidgets();

    if (ddActiveHit && el.contains(ddActiveHit)) closeDdMenu();

    updateEditButtons(sel.length);

    // 没有选中时也保持属性栏占位（显示提示文字），避免画布高度变化
    if (sel.length === 0) {
        el.innerHTML = '<span class="widget-props-hint">' + (currentLanguage === 'en-US' ? 'Select a widget to edit its properties' : '选中组件后，在此编辑它的属性') + '</span>';
        closeWidgetProps();
        if (btnDel) btnDel.disabled = true;
        return;
    }
    if (btnDel) btnDel.disabled = false;

    var html = '';

    // 多选：只提供可批量应用的通用样式
    if (sel.length > 1) {
        var cAlign = commonValue(sel, 'align');
        html += '<span class="widget-props-title">' + (currentLanguage === 'en-US' ? 'Selected ' + sel.length + ' widgets' : '已选 ' + sel.length + ' 个组件') + '</span><div class="widget-props-content">';
        html += '<div class="prop-section"><span class="prop-section-title">外观</span>';
        html += propColor('color', '文字色', commonValue(sel, 'color'));
        html += propColor('bg', '背景色', commonValue(sel, 'bg'));
        html += propNum('font', '字号', commonValue(sel, 'font'), 8, 96, '');
        html += propSelect('align', '对齐', cAlign === null ? '' : cAlign, alignOptions());
        html += propCheck('bold', '加粗', commonValue(sel, 'bold') === true);
        html += '</div></div>';
        el.innerHTML = html;
        applyLocalization(currentLanguage, el);
        initCustomSelects(el);
        bindProps(el);
        return;
    }

    var w = sel[0];
    html += '<span class="widget-props-title">' + widgetTypeLabel(w.type) + '</span><div class="widget-props-content">';
    html += '<div class="prop-section"><span class="prop-section-title">位置与尺寸</span>';
    html += propNum('x', 'X', w.x, 0, null, '');
    html += propNum('y', 'Y', w.y, 0, null, '');
    html += propNum('w', '宽', w.w, 20, null, '');
    html += propNum('h', '高', w.h, 20, null, '');
    html += '</div><div class="prop-section"><span class="prop-section-title">外观</span>';
    html += propNum('font', '字号', w.font, 8, 96, '');
    html += propColor('color', '文字色', w.color);
    html += propColor('bg', '背景色', w.bg);
    html += propSelect('align', '对齐', w.align || '', alignOptions());
    html += propCheck('bold', '加粗', w.bold === true);
    html += propCheck('border', '边框', w.border === true);
    html += '</div><div class="prop-section"><span class="prop-section-title">标签与内容</span>';

    // 按类型显示相关字段，隐藏无关项
    if (w.type === 'value' || w.type === 'lamp' || w.type === 'bar' || w.type === 'button' ||
        w.type === 'gauge' || w.type === 'switch' || w.type === 'alarm' || w.type === 'trend') {
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
        html += propSelect('action', '动作', w.action || 'toggle', actionOptions());
        html += propColor('btnColor', '按钮色', w.btnColor);
    } else if (w.type === 'rect') {
        html += propNum('radius', '圆角', w.radius, 0, 60, '0');
        html += propColor('borderColor', '边框色', w.borderColor);
    } else if (w.type === 'gauge') {
        html += propText('label', '标题', w.label, '留空则显示标签名');
        html += propNum('min', '最小值', w.min, null, null, '0');
        html += propNum('max', '最大值', w.max, null, null, '100');
        html += propText('unit', '单位', w.unit, '如 ℃ / %');
        html += propColor('barColor', '指针色', w.barColor);
    } else if (w.type === 'switch') {
        html += propText('label', '名称', w.label, '留空则显示标签名');
        html += propText('onText', '开启文字', w.onText, 'ON');
        html += propText('offText', '关闭文字', w.offText, 'OFF');
        html += propColor('onColor', '开启颜色', w.onColor);
    } else if (w.type === 'alarm') {
        html += propText('label', '名称', w.label, '留空则显示标签名');
        html += propText('alarmText', '报警文字', w.alarmText, '报警');
        html += propText('normalText', '正常文字', w.normalText, '正常');
        html += propNum('threshold', '报警阈值', w.threshold, null, null, '数值标签使用');
        html += propSelect('compare', '比较方式', w.compare || 'gte', compareOptions());
        html += propSelect('alarmWhen', 'Bool 报警条件', w.alarmWhen || 'true', alarmWhenOptions());
        html += propColor('alarmColor', '报警颜色', w.alarmColor);
    } else if (w.type === 'trend') {
        html += propText('label', '标题', w.label, '留空则显示标签名');
        html += propNum('min', '纵轴最小值', w.min, null, null, '自动');
        html += propNum('max', '纵轴最大值', w.max, null, null, '自动');
        html += propText('unit', '单位', w.unit, '可选');
        html += propColor('barColor', '曲线色', w.barColor);
    }

    html += '</div></div>';
    el.innerHTML = html;
    applyLocalization(currentLanguage, el);
    initCustomSelects(el);
    bindProps(el);
}

function openWidgetProps(id, clientX, clientY) {
    if (!id || state.preview) return;
    selectWidget(id, false);
    var overlay = document.getElementById('widgetProps');
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    var popup = overlay.querySelector('.widget-props-modal');
    var rect = popup.getBoundingClientRect();
    var x = clientX === undefined ? 24 : clientX;
    var y = clientY === undefined ? 24 : clientY;
    var left = Math.max(8, Math.min(x + 12, window.innerWidth - rect.width - 8));
    var top = Math.max(8, Math.min(y + 12, window.innerHeight - rect.height - 8));
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    var firstInput = document.querySelector('#widgetPropsContent [data-prop]');
    if (firstInput) firstInput.focus();
}

function closeWidgetProps() {
    var overlay = document.getElementById('widgetProps');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    closeDdMenu();
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
        if (state.preview || e.button !== 0) return;     // 只用左键编辑和拖动
        var wEl = e.target.closest('.widget');
        var additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (!wEl) { setSelection([]); return; }

        var id = wEl.dataset.id;
        var handle = e.target.closest('.widget-resize-handle');
        var alreadySelected = state.selectedWidgets.indexOf(id) >= 0;
        if (additive) {
            selectWidget(id, true);
            return;                                      // 加选时不启动拖动
        }
        if (!alreadySelected) selectWidget(id, false);

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

    canvas.addEventListener('contextmenu', function (e) {
        var wEl = e.target.closest('.widget');
        if (state.preview || !wEl) return;
        e.preventDefault();
        openWidgetProps(wEl.dataset.id, e.clientX, e.clientY);
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
        var switchEl = e.target.closest('.widget-switch');
        if (switchEl) {
            var switchWidget = getWidget(switchEl.closest('.widget').dataset.id);
            if (switchWidget) runWidgetSwitch(switchWidget);
            return;
        }
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

function runWidgetSwitch(w) {
    var idx = findTagIndex(w.tag);
    if (idx < 0) { showToast('该开关未绑定标签', 'error'); return; }
    if (!state.connected) { showToast('PLC 未连接，无法切换。请先连接。', 'error'); return; }
    var tag = state.tags[idx];
    if (tag.dataType !== 'Bool') { showToast('开关组件只能绑定 Bool 标签', 'error'); return; }
    postToCSharp({ action: 'writeValue', index: idx, value: !(tag.value === true) });
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

function updateScreenModeUI() {
    var canvas = document.getElementById('screenCanvas');
    var editor = document.getElementById('screensView');
    if (canvas) canvas.classList.toggle('preview', state.preview);
    if (editor) editor.classList.toggle('screen-browse-mode', state.preview);
    var btn = document.getElementById('btnScreenMode');
    if (btn) {
        btn.classList.toggle('active', state.preview);
        btn.setAttribute('aria-pressed', state.preview ? 'true' : 'false');
        btn.textContent = state.preview ? (currentLanguage === 'en-US' ? 'Exit browse' : '退出浏览') : (currentLanguage === 'en-US' ? 'Browse' : '浏览');
        btn.title = state.preview ? (currentLanguage === 'en-US' ? 'Exit browse mode and return to editing' : '退出浏览模式并返回编辑') : (currentLanguage === 'en-US' ? 'Enter browse mode to use screen buttons' : '进入浏览模式并操作画面按钮');
    }
    var hint = document.getElementById('screenModeHint');
    if (hint) {
        hint.textContent = state.preview
            ? (currentLanguage === 'en-US' ? 'Browse mode: click screen buttons to act · click "Exit browse" to return to editing' : '浏览模式：点击画面按钮执行操作 · 点击“退出浏览”返回编辑')
            : (currentLanguage === 'en-US' ? 'Edit mode: right-click to edit properties · drag to move widgets · click "Browse" to interact' : '编辑模式：右键修改属性 · 拖动调整组件 · 点击“浏览”操作画面');
    }
}

function togglePreview() {
    state.preview = !state.preview;
    updateScreenModeUI();
    if (state.preview) {
        closeWidgetProps();
        setSelection([]);
    }
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
    if (state.view !== 'screens' || state.preview) return;
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
            if (!e.repeat) pushUndo();
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

// ── Settings Dialog Triggers ─────────────────────────────────
(function initSettingsDialog() {
    var btn = document.getElementById('btnSettings');
    if (btn) btn.addEventListener('click', openSettings);
    var closeBtn = document.getElementById('btnCloseSettings');
    if (closeBtn) closeBtn.addEventListener('click', closeSettings);
    var footBtn = document.getElementById('btnCloseSettingsFoot');
    if (footBtn) footBtn.addEventListener('click', closeSettings);
})();
