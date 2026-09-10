import type { Dict } from './en';

/**
 * Simplified Chinese dictionary (default locale).
 *
 * Key parity with `en` is enforced by the `Dict` type: a missing or extra
 * key fails `pnpm typecheck`.
 *
 * Values mirror the strings this UI shipped with, byte for byte, so
 * switching to the dictionary does not change rendered output. The
 * error/404 fallbacks shipped in English and are translated here
 * instead.
 */
export const zhCN: Dict = {
  // Shared
  'common.loading': '加载中…',
  'common.refresh': '刷新',
  'common.clear': '清除',
  'common.close': '关闭',

  // API error fallbacks (utils/api-error.ts)
  'errors.httpDetail': 'HTTP {{status}}: {{detail}}',
  'errors.network': '网络错误',
  'errors.validation': '校验错误',
  'errors.unexpectedStatus': '未知状态码 {{status}}',
  'errors.unexpected': '意外错误',
  'errors.unknown': '未知错误',

  // Root route (__root.tsx)
  'root.notFound': '404 - 页面不存在',
  'root.goHome': '返回首页',

  // Navigation (Sidebar, Header)
  'nav.dashboard': '仪表盘',
  'nav.tasks': '任务',
  'nav.upload': '上传解析',
  'nav.download': '结果下载',
  'nav.apiKeys': 'API Keys',
  'nav.profile': '个人资料',
  'nav.adminKeys': 'Key 管理',
  'nav.adminUsers': '用户管理',
  'nav.admin': '管理',
  'nav.taskDetail': '任务详情',
  'nav.logout': '退出登录',
  'nav.language': '语言',

  // Task statuses (StatusBadge, filters, dashboard)
  'status.pending': '排队中',
  'status.processing': '处理中',
  'status.retry_pending': '等待重试',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',

  // MinerU language options (upload page)
  'mineruLang.label.ch': '中文',
  'mineruLang.label.ch_server': '中文服务端版',
  'mineruLang.label.korean': '韩文',
  'mineruLang.label.ta': '泰米尔文',
  'mineruLang.label.te': '泰卢固文',
  'mineruLang.label.ka': '卡纳达文',
  'mineruLang.label.th': '泰文',
  'mineruLang.label.el': '希腊文',
  'mineruLang.label.arabic': '阿拉伯语系',
  'mineruLang.label.east_slavic': '东斯拉夫语系',
  'mineruLang.label.cyrillic': '西里尔语系',
  'mineruLang.label.devanagari': '天城文语系',
  'mineruLang.coverage.ch': '中文、英文、日文、繁体中文、拉丁文',
  'mineruLang.coverage.ch_server': '中文、英文、日文、繁体中文、拉丁文（准确率更高/消耗更多资源）',
  'mineruLang.coverage.korean': '韩文、英文',
  'mineruLang.coverage.ta': '泰米尔文、英文',
  'mineruLang.coverage.te': '泰卢固文、英文',
  'mineruLang.coverage.ka': '卡纳达文',
  'mineruLang.coverage.th': '泰文、英文',
  'mineruLang.coverage.el': '希腊文、英文',
  'mineruLang.coverage.arabic': '阿拉伯语、波斯语、维吾尔语、乌尔都语、普什图语、库尔德语、信德语、俾路支语、英文',
  'mineruLang.coverage.east_slavic': '俄语、白俄罗斯语、乌克兰语、英文',
  'mineruLang.coverage.cyrillic': '俄/白俄/乌克兰/塞尔维亚/保加利亚/蒙古/哈萨克/吉尔吉斯/塔吉克等 30+ 种使用西里尔字母的语言、英文',
  'mineruLang.coverage.devanagari': '印地语、马拉地语、尼泊尔语、比哈里语、迈蒂利语、梵语等 14 种使用天城文的语言、英文',

  // Upload page
  'upload.fileSection': '文件',
  'upload.filePicker': '点击选择文件(可多选)',
  'upload.submitted': '任务已提交',
  'upload.taskIdLabel': '任务 ID:',
  'upload.fileCount': '({{count}} 个文件)',
  'upload.viewDetail': '查看任务详情 →',
  'upload.optionsSection': '解析选项',
  'upload.backend': '后端',
  'upload.parseMethod': '解析方式',
  'upload.effort': 'Effort',
  'upload.serverUrl': 'Server URL',
  'upload.language': '语言(可多选)',
  'upload.langTableOption': '选项',
  'upload.langTableCoverage': '覆盖语言',
  'upload.formula': '公式识别',
  'upload.table': '表格识别',
  'upload.imageAnalysis': '图像分析',
  'upload.zipDownload': 'Zip 格式下载',
  'upload.submit': '提交任务({{count}} 个文件)',
  'upload.submitting': '提交中…',
  'upload.errNoFile': '请先选择要解析的文件',
  'upload.errServerUrlRequired': '当前后端需要填写 Server URL',

  // Task list
  'tasks.filterStatus': '状态',
  'tasks.filterAll': '全部',
  'tasks.filterFileName': '文件名',
  'tasks.searchPlaceholder': '按文件名搜索',
  'tasks.search': '查询',
  'tasks.batchCancel': '批量取消({{count}})',
  'tasks.empty': '没有符合条件的任务。',
  'tasks.thTaskId': '任务 ID',
  'tasks.thStatus': '状态',
  'tasks.thBackend': '后端',
  'tasks.thFiles': '文件',
  'tasks.thCreatedAt': '创建时间',
  'tasks.thRetries': '重试',
  'tasks.thActions': '操作',
  'tasks.cancel': '取消',
  'tasks.confirmCancel': '确定取消任务 …{{shortId}} 吗?',
  'tasks.confirmBatchCancel': '确定批量取消选中的 {{count}} 个任务吗?',
  'tasks.batchResult': '已取消 {{cancelled}} 个,{{failed}} 个失败',

  // Task detail
  'taskDetail.back': '返回任务列表',
  'taskDetail.title': '任务',
  'taskDetail.backend': '后端',
  'taskDetail.fileCount': '文件数',
  'taskDetail.retries': '重试次数',
  'taskDetail.createdAt': '创建时间',
  'taskDetail.startedAt': '开始时间',
  'taskDetail.completedAt': '完成时间',
  'taskDetail.elapsed': '耗时',
  'taskDetail.queuedAhead': '排队前方任务数',
  'taskDetail.fileList': '文件列表',
  'taskDetail.error': '错误信息',
  'taskDetail.cancel': '取消任务',
  'taskDetail.download': '下载结果',
  'taskDetail.confirmCancel': '确定取消该任务吗?',

  // Result download page
  'download.description': '这里列出所有已完成的任务,可单个下载或勾选后打包下载 ZIP。',
  'download.pack': '打包下载({{count}})',
  'download.empty': '还没有已完成的任务。',
  'download.thTaskId': '任务 ID',
  'download.thFiles': '文件',
  'download.thCompletedAt': '完成时间',
  'download.thActions': '操作',
  'download.one': '下载',
  'download.notDownloadable': '部分任务不可下载:{{failed}}。请取消勾选后重试。',
  'download.unknownReason': '未知原因',

  // API key table (shared by /api-keys and /admin/keys)
  'keyTable.prefix': '前缀',
  'keyTable.label': '备注',
  'keyTable.createdAt': '创建时间',
  'keyTable.lastUsed': '最近使用',
  'keyTable.expiresAt': '过期时间',
  'keyTable.status': '状态',
  'keyTable.actions': '操作',
  'keyTable.inUse': '当前使用',
  'keyTable.valid': '有效',
  'keyTable.revoked': '已吊销',
  'keyTable.revoke': '吊销',
  'keyTable.confirmRevoke': '确定吊销 Key「{{name}}」吗?此操作不可撤销。',

  // API keys page
  'apiKeys.createTitle': '创建新 Key',
  'apiKeys.label': '备注(可选)',
  'apiKeys.labelPlaceholder': '例如:笔记本',
  'apiKeys.expiresAt': '过期时间(可选)',
  'apiKeys.creating': '创建中…',
  'apiKeys.create': '创建',
  'apiKeys.listTitle': '我的 Keys',
  'apiKeys.empty': '还没有 API Key,先创建一个吧。',
  'apiKeys.errUnverified': '邮箱未验证，无法创建 API Key。请先完成邮箱验证后重试。',
  'apiKeys.activeKeyTitle': '当前使用的 Key',
  'apiKeys.activeKeyDesc': '任务相关接口(列表、上传、下载)通过 API Key 鉴权。创建 Key 后可一键在此浏览器使用, 或粘贴已有 Key。',
  'apiKeys.notSet': '尚未设置,任务页面将无法加载数据。',
  'apiKeys.manualTitle': '手动设置已有 Key',
  'apiKeys.pastePlaceholder': '粘贴完整 API Key',
  'apiKeys.set': '设置',

  // NoActiveKey placeholder
  'noActiveKey.title': '需要先设置 API Key',
  'noActiveKey.description': '任务相关接口通过 API Key 鉴权。请先在 API Keys 页面创建一个 Key 并在此浏览器中使用, 或粘贴已有 Key。',
  'noActiveKey.goTo': '前往 API Keys',

  // One-time key reveal
  'apiKeyReveal.title': 'Key 创建成功 — 请立即保存,完整 Key 只显示这一次',
  'apiKeyReveal.copied': '已复制',
  'apiKeyReveal.copy': '复制',
  'apiKeyReveal.useHere': '在此浏览器中使用此 Key',

  // Admin token gate
  'adminGate.title': '需要管理令牌',
  'adminGate.description': '管理接口使用网关管理令牌(GATEWAY_ADMIN_TOKEN)鉴权,仅保存在当前标签页中。',
  'adminGate.tokenLabel': '管理令牌',
  'adminGate.submit': '确定',
  'adminGate.setNotice': '管理令牌已设置(仅当前标签页)',

  // Admin: keys
  'adminKeys.issueTitle': '签发新 Key',
  'adminKeys.label': '备注(可选)',
  'adminKeys.expiresAt': '过期时间(可选)',
  'adminKeys.issuing': '签发中…',
  'adminKeys.issue': '签发',
  'adminKeys.listTitle': '全部 Keys',
  'adminKeys.empty': '还没有任何 API Key。',

  // Admin: users
  'adminUsers.createdTitle': '用户创建成功',
  'adminUsers.nameSuffix': '({{name}})',
  'adminUsers.superuserTag': ' · 管理员',
  'adminUsers.createTitle': '创建用户',
  'adminUsers.email': '邮箱',
  'adminUsers.initialPassword': '初始密码',
  'adminUsers.displayName': '显示名称(可选)',
  'adminUsers.superuser': '管理员',
  'adminUsers.creating': '创建中…',
  'adminUsers.submit': '创建用户',

  // Pagination
  'pagination.prev': '上一页',
  'pagination.next': '下一页',
  'pagination.info': '第 {{page}} / {{totalPages}} 页 · 共 {{total}} 条',

  // Profile
  'profile.accountInfo': '账号信息',
  'profile.email': '邮箱',
  'profile.role': '角色',
  'profile.roleAdmin': '管理员',
  'profile.roleUser': '普通用户',
  'profile.emailVerification': '邮箱验证',
  'profile.verified': '已验证',
  'profile.unverified': '未验证',
  'profile.registeredAt': '注册时间',
  'profile.editTitle': '修改资料',
  'profile.displayName': '显示名称',
  'profile.newPassword': '新密码(留空则不修改)',
  'profile.confirmNewPassword': '确认新密码',
  'profile.saving': '保存中…',
  'profile.save': '保存',
  'profile.saved': '已保存',
  'profile.errPasswordMismatch': '两次输入的密码不一致',
  'profile.errNoChanges': '没有需要保存的修改',

  // Login
  'login.title': '登录',
  'login.email': '邮箱',
  'login.password': '密码',
  'login.submit': '登录',
  'login.submitting': '登录中…',
  'login.oauthDivider': '第三方登录',
  'login.oauthButton': '{{provider}} 登录',
  'login.noAccount': '还没有账号?',
  'login.toRegister': '注册',

  // Register
  'register.title': '注册',
  'register.email': '邮箱',
  'register.displayName': '显示名称(可选)',
  'register.password': '密码',
  'register.confirmPassword': '确认密码',
  'register.submit': '注册',
  'register.submitting': '注册中…',
  'register.errPasswordMismatch': '两次输入的密码不一致',
  'register.hasAccount': '已有账号?',
  'register.toLogin': '登录',
  'register.successTitle': '注册成功',
  'register.successPrefix': '验证邮件已发送至 ',
  'register.successSuffix': '，请查收并点击验证链接完成邮箱验证，然后登录。',
  'register.goLogin': '去登录',

  // OAuth callback / email verification landing
  'oauth.completing': '正在完成登录…',
  'oauth.failedTitle': '登录失败',
  'oauth.backToLogin': '返回登录',
  'oauth.errMissingTokens': '登录回调缺少令牌参数,请重试',
  'oauth.errLoginFailed': '登录失败,请重试',
  'oauth.verifyFailedTitle': '邮箱验证失败',
  'oauth.verifyFailedBody': '验证链接无效或已过期，请重新申请验证邮件。',
  'oauth.verifySuccessTitle': '邮箱验证成功',
  'oauth.verifySuccessBody': '您的邮箱已通过验证，现在可以创建 API Key。',
  'oauth.goLogin': '去登录',
  'oauth.goHome': '返回首页',

  // Email verification dialog
  'emailVerification.title': '邮箱验证',
  'emailVerification.body': '您的邮箱尚未验证。验证邮箱后才能创建 API Key。验证邮件已发送至您的邮箱，请查收并点击其中的验证链接；未收到时可点击下方按钮重新发送。',
  'emailVerification.sent': '验证邮件已发送，请查收。',
  'emailVerification.send': '发送验证邮件',
  'emailVerification.resend': '重新发送验证邮件',
  'emailVerification.sending': '发送中…',
  'emailVerification.check': '我已验证，刷新状态',
  'emailVerification.checking': '检查中…',
  'emailVerification.errNotVerified': '尚未完成验证，请点击邮件中的验证链接后重试',

  // Dashboard
  'dashboard.welcome': '欢迎,{{name}}',
  'dashboard.statusSection': '任务状态',
  'dashboard.overviewSection': '概览',
  'dashboard.todayCompleted': '今日完成',
  'dashboard.todayFailed': '今日失败',
  'dashboard.totalBytes': '累计处理数据量',
  'dashboard.avgDuration': '平均耗时',
  'dashboard.footerPrefix': '查看',
  'dashboard.tasksLink': '任务列表',
  'dashboard.footerSuffix': '了解每个任务的详情。',

  // Duration units (utils/format.ts)
  'format.hourShort': '{{n}}小时',
  'format.minuteShort': '{{n}}分',
  'format.secondShort': '{{n}}秒',
};
