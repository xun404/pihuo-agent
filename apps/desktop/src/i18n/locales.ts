import type { WorkerRole } from '@router-agents/shared'

export type Locale = 'zh' | 'en'

export type MessageKey =
  | 'app.title'
  | 'app.apiUp'
  | 'app.apiDown'
  | 'app.mastraOffline'
  | 'app.mastraConnected'
  | 'app.workersCount'
  | 'app.loading'
  | 'app.idle'
  | 'app.modeSuffix'
  | 'app.bannerOffline'
  | 'app.bannerCmd'
  | 'sidebar.projects'
  | 'sidebar.search'
  | 'sidebar.empty'
  | 'sidebar.newSession'
  | 'sidebar.seedDemo'
  | 'sidebar.seedDemoHint'
  | 'sidebar.openProject'
  | 'sidebar.now'
  | 'sidebar.deleteProject'
  | 'sidebar.deleteSession'
  | 'sidebar.confirmDeleteProject'
  | 'sidebar.confirmDeleteSession'
  | 'sidebar.expand'
  | 'sidebar.collapse'
  | 'sidebar.noSessions'
  | 'common.refresh'
  | 'git.insertions'
  | 'git.deletions'
  | 'git.clean'
  | 'git.error'
  | 'git.noProject'
  | 'files.empty'
  | 'files.error'
  | 'files.noProject'
  | 'files.truncated'
  | 'workers.registerTitle'
  | 'workers.formName'
  | 'workers.formCommand'
  | 'workers.formArgs'
  | 'workers.formSave'
  | 'chat.openSession'
  | 'chat.openSessionHint'
  | 'chat.serverDown'
  | 'chat.ready'
  | 'chat.connected'
  | 'chat.offline'
  | 'chat.readyBody'
  | 'chat.mode'
  | 'chat.model'
  | 'chat.noModelConfigured'
  | 'chat.noModelHint'
  | 'chat.openSettings'
  | 'chat.project'
  | 'chat.path'
  | 'chat.leader'
  | 'chat.you'
  | 'chat.placeholder'
  | 'chat.stop'
  | 'chat.error'
  | 'chat.tool'
  | 'chat.toolError'
  | 'chat.thinking'
  | 'chat.thinkingLive'
  | 'chat.think.label'
  | 'chat.think.short'
  | 'chat.think.hint'
  | 'chat.think.off'
  | 'chat.think.low'
  | 'chat.think.medium'
  | 'chat.think.high'
  | 'chat.think.max'
  | 'mode.ask'
  | 'mode.plan'
  | 'mode.build'
  | 'mode.review'
  | 'right.workers'
  | 'right.jobs'
  | 'right.git'
  | 'right.files'
  | 'right.approvals'
  | 'right.activity'
  | 'workers.registered'
  | 'workers.register'
  | 'workers.primary'
  | 'workers.roles'
  | 'workers.formHint'
  | 'workers.healthHint'
  | 'workers.healthAll'
  | 'workers.healthAllHint'
  | 'workers.healthDetail'
  | 'workers.healthNoDetail'
  | 'workers.healthDeep'
  | 'workers.health.healthy'
  | 'workers.health.unhealthy'
  | 'workers.health.missing'
  | 'workers.health.unknown'
  | 'workers.busy'
  | 'workers.model'
  | 'workers.modelDefault'
  | 'workers.modelPlaceholder'
  | 'workers.modelFetch'
  | 'workers.modelFetchHint'
  | 'workers.modelCurrent'
  | 'workers.modelRefresh'
  | 'workers.modelLoading'
  | 'workers.modelComboHint'
  | 'workers.modelManual'
  | 'jobs.title'
  | 'jobs.empty'
  | 'jobs.dispatch'
  | 'jobs.dispatchRole'
  | 'jobs.dispatchPlaceholder'
  | 'jobs.needSession'
  | 'jobs.cancel'
  | 'jobs.retry'
  | 'approvals.empty'
  | 'approvals.pending'
  | 'approvals.allow'
  | 'approvals.deny'
  | 'approvals.cancel'
  | 'approvals.demo'
  | 'approvals.resolved'
  | 'approvals.worker'
  | 'approvals.target'
  | 'activity.ready'
  | 'activity.empty'
  | 'role.plan'
  | 'role.coder'
  | 'role.review'
  | 'role.test'
  | 'role.research'
  | 'role.general'
  | 'prompt.sessionTitle'
  | 'prompt.sessionDefault'
  | 'prompt.projectPath'
  | 'prompt.ok'
  | 'prompt.cancel'
  | 'prompt.browse'
  | 'prompt.noFolder'
  | 'prompt.dialogTitle'
  | 'prompt.dialogButton'
  | 'prompt.dialogMessage'
  | 'lang.zh'
  | 'lang.en'
  | 'lang.label'
  | 'theme.label'
  | 'theme.system'
  | 'theme.light'
  | 'theme.dark'
  | 'settings.title'
  | 'settings.subtitle'
  | 'settings.close'
  | 'settings.save'
  | 'settings.saved'
  | 'settings.security'
  | 'settings.securityHint'
  | 'settings.safeStorageOn'
  | 'settings.safeStorageOff'
  | 'settings.model'
  | 'settings.modelHint'
  | 'settings.provider'
  | 'settings.leaderModel'
  | 'settings.customModel'
  | 'settings.apiKeys'
  | 'settings.filterProviders'
  | 'settings.enterKey'
  | 'settings.configured'
  | 'settings.clear'
  | 'settings.keyCleared'
  | 'settings.tabModel'
  | 'settings.tabProviders'
  | 'settings.tabAbout'
  | 'settings.pickProvider'
  | 'settings.pickModel'
  | 'settings.thinking'
  | 'settings.thinkingHint'
  | 'settings.providerKey'
  | 'settings.needKey'
  | 'settings.keyReady'
  | 'settings.keyRequired'
  | 'settings.keyOptionalUpdate'
  | 'settings.updateKey'
  | 'settings.showCustom'
  | 'settings.hideCustom'
  | 'settings.current'
  | 'settings.sources'
  | 'settings.modelDocs'
  | 'settings.show'
  | 'settings.hide'
  | 'settings.customIntro'
  | 'settings.customEmpty'
  | 'settings.addCustomProvider'
  | 'settings.editCustom'
  | 'settings.customId'
  | 'settings.customName'
  | 'settings.customEnv'
  | 'settings.customModelId'
  | 'settings.customModelLabel'
  | 'settings.customDocs'
  | 'settings.customRequired'
  | 'settings.customModelFormat'
  | 'settings.customIdTaken'
  | 'settings.customDrafted'
  | 'settings.customSaveHint'
  | 'settings.customBadge'
  | 'settings.edit'
  | 'settings.remove'
  | 'settings.cancelEdit'
  | 'settings.updateCustom'
  | 'settings.addToList'
  | 'settings.customApiStyle'
  | 'settings.customBaseUrl'
  | 'settings.customContext'
  | 'settings.customModelContext'
  | 'settings.customNamePh'
  | 'settings.customBaseUrlHint'
  | 'settings.customApiStyleHint'
  | 'settings.customModelPh'
  | 'settings.customModelHint'
  | 'settings.customApiKey'
  | 'settings.customApiKeyPh'
  | 'settings.customApiKeyHint'
  | 'settings.customContextHint'
  | 'settings.styleOpenai'
  | 'settings.styleAnthropic'
  | 'settings.styleGoogle'
  | 'settings.showAdvanced'
  | 'settings.hideAdvanced'
  | 'right.goals'
  | 'goals.title'
  | 'goals.hint'
  | 'goals.placeholder'
  | 'goals.set'
  | 'goals.clear'
  | 'goals.empty'
  | 'goals.status'
  | 'goals.thread'

type Dict = Record<MessageKey, string>

const zh: Dict = {
  'app.title': 'Router Agents',
  'app.apiUp': 'API 已连接',
  'app.apiDown': 'API 离线',
  'app.mastraOffline': 'Mastra 离线',
  'app.mastraConnected': 'Mastra Leader 已连接',
  'app.workersCount': '{n} 个 Worker',
  'app.loading': '加载中…',
  'app.idle': '空闲',
  'app.modeSuffix': '模式',
  'app.bannerOffline': '无法连接 Mastra（{error}）。另开终端运行：',
  'app.bannerCmd': 'npm run dev:mastra',
  'sidebar.projects': '项目',
  'sidebar.search': '搜索项目或 Session…',
  'sidebar.empty': '还没有项目。请「打开项目」并输入本地目录路径。',
  'sidebar.newSession': '＋ 新建 Session',
  'sidebar.seedDemo': '调试：Seed 本仓库',
  'sidebar.seedDemoHint': '可选调试：用当前 API 工作目录快速注册示例项目',
  'sidebar.openProject': '打开项目…',
  'sidebar.now': '现在',
  'sidebar.deleteProject': '删除项目',
  'sidebar.deleteSession': '删除 Session',
  'sidebar.confirmDeleteProject': '删除项目「{name}」及其全部 Session？此操作不可撤销。',
  'sidebar.confirmDeleteSession': '删除 Session「{title}」？此操作不可撤销。',
  'sidebar.expand': '展开项目',
  'sidebar.collapse': '折叠项目',
  'sidebar.noSessions': '暂无 Session',
  'prompt.projectPath': '项目根目录绝对路径',
  'prompt.ok': '确定',
  'prompt.cancel': '取消',
  'prompt.browse': '选择文件夹…',
  'prompt.noFolder': '未能读取文件夹绝对路径。请重试选择，或直接把路径粘贴到输入框。',
  'prompt.dialogTitle': '选择项目文件夹',
  'prompt.dialogButton': '选择此文件夹',
  'prompt.dialogMessage': '选择要作为项目打开的本地目录',
  'common.refresh': '刷新',
  'git.insertions': '新增行',
  'git.deletions': '删除行',
  'git.clean': '工作区干净，无变更。',
  'git.error': '无法读取 Git 状态',
  'git.noProject': '请先打开项目',
  'files.empty': '目录为空',
  'files.error': '无法列出文件',
  'files.noProject': '请先打开项目',
  'files.truncated': '列表已截断（达到深度/数量上限）',
  'workers.registerTitle': '注册 CLI Worker',
  'workers.formName': '名称',
  'workers.formCommand': '命令',
  'workers.formArgs': '参数（空格分隔）',
  'workers.formSave': '保存',
  'chat.openSession': '打开 Session 开始协作',
  'chat.openSessionHint':
    '选择左侧 Session，或新建一个。Mastra Leader 会按角色协调 plan / coder / review / test 等 CLI Worker。',
  'chat.serverDown': 'Mastra 服务未连接（localhost:4111）。请先运行 npm run dev:mastra',
  'chat.ready': '就绪',
  'chat.connected': '已连接',
  'chat.offline': '离线',
  'chat.readyBody':
    '描述你的任务。我会读取 Workers 与角色（plan/coder/review/test…），制定计划，并在需要时 dispatch-worker 委派。',
  'chat.mode': '模式',
  'chat.model': '模型',
  'chat.noModelConfigured': '未配置 Key',
  'chat.noModelHint': '还没有可用的模型，请先在设置中配置 API Key。',
  'chat.openSettings': '打开设置',
  'chat.project': '项目',
  'chat.path': '路径',
  'chat.leader': 'Mastra Supervisor',
  'chat.you': '你',
  'chat.placeholder': '描述任务，或指定角色/Worker…（⌘↵ 发送）',
  'chat.stop': '停止',
  'chat.error': '对话错误',
  'chat.tool': '工具',
  'chat.toolError': '失败',
  'chat.thinking': '思考',
  'chat.thinkingLive': '进行中…',
  'chat.think.label': '思考强度',
  'chat.think.short': '思考',
  'chat.think.hint': '控制推理/思考预算；默认折叠显示思考过程与工具调用',
  'chat.think.off': '关闭',
  'chat.think.low': '低',
  'chat.think.medium': '中',
  'chat.think.high': '高',
  'chat.think.max': '最高',
  'mode.ask': '问答',
  'mode.plan': '规划',
  'mode.build': '构建',
  'mode.review': '审查',
  'right.workers': 'Workers',
  'right.jobs': 'Jobs',
  'right.git': 'Git',
  'right.files': '文件',
  'right.approvals': '审批',
  'right.activity': '动态',
  'workers.registered': '已注册 CLI',
  'workers.register': '＋ 注册',
  'workers.primary': '主角色',
  'workers.roles': '角色',
  'workers.formHint':
    '预设：Claude Code（coder）、Codex（review）、OpenCode（general）。可通过 API 注册自定义 Worker 并设置 roles。',
  'workers.healthHint': '点击检查命令是否可用',
  'workers.healthAll': '全部检查',
  'workers.healthAllHint': '检查所有已启用 Worker 的可用性',
  'workers.healthDetail': '健康详情',
  'workers.healthNoDetail': '暂无详情。点击状态徽章进行检查。',
  'workers.healthDeep': '深度检查（启动 ACP 进程）',
  'workers.health.healthy': '可用',
  'workers.health.unhealthy': '异常',
  'workers.health.missing': '未安装',
  'workers.health.unknown': '未检查',
  'workers.busy': '忙碌',
  'workers.model': '模型',
  'workers.modelDefault': '默认（CLI）',
  'workers.modelPlaceholder': 'model id，如 claude-sonnet-4…',
  'workers.modelFetch': '↻ 从 ACP 加载模型列表…',
  'workers.modelFetchHint': '启动 Worker 并读取可用模型',
  'workers.modelCurrent': '当前模型',
  'workers.modelRefresh': '↻ 更新模型列表…',
  'workers.modelLoading': '正在从 ACP 加载…',
  'workers.modelComboHint': '选择模型；选「加载/更新列表」会启动 ACP 拉取',
  'workers.modelManual': '✎ 手动输入 model id…',
  'jobs.title': 'Worker 任务',
  'jobs.empty': '暂无任务。可在下方派发，或由 Leader 调用 dispatch-worker。',
  'jobs.dispatch': '派发任务',
  'jobs.dispatchRole': '角色',
  'jobs.dispatchPlaceholder': '描述要委派给 Worker 的任务…',
  'jobs.needSession': '请先打开一个 Session 再派发。',
  'jobs.cancel': '取消',
  'jobs.retry': '重试',
  'approvals.empty': '暂无待批权限。ACP 权限请求会进入此队列。',
  'approvals.pending': '待审批',
  'approvals.allow': '允许',
  'approvals.deny': '拒绝',
  'approvals.cancel': '取消',
  'approvals.demo': '模拟权限请求',
  'approvals.resolved': '已处理',
  'approvals.worker': 'Worker',
  'approvals.target': '目标',
  'activity.ready': 'Leader 就绪 · chat via /chat/router-leader',
  'activity.empty': '暂无活动。打开项目、委派任务或处理审批后会显示在这里。',
  'role.plan': '规划',
  'role.coder': '编码',
  'role.review': '审查',
  'role.test': '测试',
  'role.research': '调研',
  'role.general': '通用',
  'prompt.sessionTitle': 'Session 标题',
  'prompt.sessionDefault': '新任务',
  'lang.zh': '中文',
  'lang.en': 'EN',
  'lang.label': '语言',
  'theme.label': '颜色模式',
  'theme.system': '系统',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'settings.title': '设置',
  'settings.subtitle': '选择 Leader 模型并安全保存 API Key',
  'settings.close': '关闭',
  'settings.save': '保存并应用',
  'settings.saved': '已保存。密钥已加密，模型将用于新对话。',
  'settings.security': '安全存储',
  'settings.securityHint':
    'API Key 使用 AES-256-GCM 加密写入本机（storage={storage} · {platform}）。Electron 下主密钥由系统安全模块保护（macOS Keychain / Windows DPAPI）。',
  'settings.safeStorageOn': 'Electron safeStorage 已启用',
  'settings.safeStorageOff': 'safeStorage 不可用，使用本地加密文件（权限 600）',
  'settings.model': 'Leader 模型',
  'settings.modelHint': '模型 id 为 provider/model，数据参考 models.dev / AI SDK',
  'settings.provider': '提供方',
  'settings.leaderModel': '模型',
  'settings.customModel': '自定义 model id',
  'settings.apiKeys': 'API Keys',
  'settings.filterProviders': '筛选提供方…',
  'settings.enterKey': '粘贴 API Key',
  'settings.configured': '已配置',
  'settings.clear': '清除',
  'settings.keyCleared': '密钥已清除',
  'settings.tabModel': '模型',
  'settings.tabProviders': '自定义 Provider',
  'settings.tabAbout': '关于',
  'settings.pickProvider': '选择提供方',
  'settings.pickModel': '选择模型',
  'settings.thinking': '思考强度',
  'settings.thinkingHint':
    '映射到模型侧 reasoning / thinking 预算（OpenAI reasoningEffort、Anthropic budget、Gemini thinkingBudget 等）。聊天栏可临时切换并写回此处。',
  'settings.providerKey': '{provider} 的 API Key',
  'settings.needKey': '需配置 Key',
  'settings.keyReady': 'Key 已就绪',
  'settings.keyRequired': '此提供方尚未配置 Key，保存前请填写。',
  'settings.keyOptionalUpdate': '可更新 Key（留空则保持原值）。',
  'settings.updateKey': '更新 Key',
  'settings.showCustom': '使用自定义 model id…',
  'settings.hideCustom': '收起自定义',
  'settings.current': '当前 Leader 模型',
  'settings.sources': '模型数据来源',
  'settings.modelDocs': '查看模型说明',
  'settings.show': '显示',
  'settings.hide': '隐藏',
  'settings.customIntro':
    '添加公司网关或第三方 API（类似 OpenCode）。一般只需：名称、地址、模型名、API Key。',
  'settings.customEmpty': '还没有自定义 Provider。填下面几项即可。',
  'settings.addCustomProvider': '添加自定义 Provider',
  'settings.editCustom': '编辑自定义 Provider',
  'settings.customId': 'Provider id',
  'settings.customName': '名称',
  'settings.customEnv': 'API Key 环境变量名',
  'settings.customModelId': '模型名',
  'settings.customModelLabel': '模型显示名',
  'settings.customDocs': '文档 URL（可选）',
  'settings.customRequired': '请填写名称和模型名。',
  'settings.customModelFormat': '模型 id 需为 provider/model 格式。',
  'settings.customIdTaken': '该名称与内置 Provider 冲突，请换一个名字。',
  'settings.customDrafted': '已加入列表。点底部「保存并应用」即可生效。',
  'settings.customSaveHint': '填完后点「加入列表」，再点底部「保存并应用」。',
  'settings.customBadge': '自定义',
  'settings.edit': '编辑',
  'settings.remove': '移除',
  'settings.cancelEdit': '取消编辑',
  'settings.updateCustom': '更新',
  'settings.addToList': '加入列表',
  'settings.customApiStyle': '接口类型',
  'settings.customBaseUrl': 'API 地址（Base URL）',
  'settings.customContext': '上下文长度（可选）',
  'settings.customModelContext': '模型上下文窗口（tokens）',
  'settings.customNamePh': '例如：公司网关、硅基流动',
  'settings.customBaseUrlHint': 'OpenAI 兼容接口的根地址，一般以 /v1 结尾。官方云服务可留空。',
  'settings.customApiStyleHint': '绝大多数第三方网关选「OpenAI 兼容」即可。',
  'settings.customModelPh': '例如 deepseek-chat 或 gpt-4o',
  'settings.customModelHint': '填模型名即可，无需写 provider/ 前缀。',
  'settings.customApiKey': 'API Key',
  'settings.customApiKeyPh': '粘贴密钥（可选，也可稍后在「模型」里填）',
  'settings.customApiKeyHint': '保存在本机加密存储，不会上传。环境变量名由系统自动生成，无需关心。',
  'settings.customContextHint': '模型上下文窗口 token 数，不清楚可留空。',
  'settings.styleOpenai': 'OpenAI 兼容',
  'settings.styleAnthropic': 'Anthropic',
  'settings.styleGoogle': 'Google',
  'settings.showAdvanced': '高级选项…',
  'settings.hideAdvanced': '收起高级选项',
  'right.goals': 'Goals',
  'goals.title': '当前目标',
  'goals.hint': '耐久目标：Leader 会跨多轮持续推进，直到 judge 判定完成。',
  'goals.placeholder': '例如：为 API 增加 /health 并补充测试',
  'goals.set': '设置目标',
  'goals.clear': '清除',
  'goals.empty': '暂无目标。设置后 Agent 会在对话中持续推进。',
  'goals.status': '状态',
  'goals.thread': '线程',
}

const en: Dict = {
  'app.title': 'Router Agents',
  'app.apiUp': 'API up',
  'app.apiDown': 'API down',
  'app.mastraOffline': 'Mastra offline',
  'app.mastraConnected': 'Mastra Leader connected',
  'app.workersCount': '{n} workers',
  'app.loading': 'loading…',
  'app.idle': 'idle',
  'app.modeSuffix': 'mode',
  'app.bannerOffline': 'Cannot reach Mastra ({error}). In another terminal run:',
  'app.bannerCmd': 'npm run dev:mastra',
  'sidebar.projects': 'Projects',
  'sidebar.search': 'Search projects or sessions…',
  'sidebar.empty': 'No projects yet. Use “Open project…” with a local path.',
  'sidebar.newSession': '+ New session',
  'sidebar.seedDemo': 'Debug: seed this repo',
  'sidebar.seedDemoHint': 'Optional: register a sample project from the API cwd',
  'sidebar.openProject': 'Open project…',
  'sidebar.now': 'now',
  'sidebar.deleteProject': 'Delete project',
  'sidebar.deleteSession': 'Delete session',
  'sidebar.confirmDeleteProject': 'Delete project “{name}” and all its sessions? This cannot be undone.',
  'sidebar.confirmDeleteSession': 'Delete session “{title}”? This cannot be undone.',
  'sidebar.expand': 'Expand project',
  'sidebar.collapse': 'Collapse project',
  'sidebar.noSessions': 'No sessions',
  'prompt.projectPath': 'Absolute path to project root',
  'prompt.ok': 'OK',
  'prompt.cancel': 'Cancel',
  'prompt.browse': 'Browse…',
  'prompt.noFolder': 'No path received. Pick a folder and click Open, or paste a path.',
  'prompt.dialogTitle': 'Select project folder',
  'prompt.dialogButton': 'Select folder',
  'prompt.dialogMessage': 'Choose a local directory to open as a project',
  'common.refresh': 'Refresh',
  'git.insertions': 'insertions',
  'git.deletions': 'deletions',
  'git.clean': 'Working tree clean.',
  'git.error': 'Could not read git status',
  'git.noProject': 'Open a project first',
  'files.empty': 'Directory is empty',
  'files.error': 'Could not list files',
  'files.noProject': 'Open a project first',
  'files.truncated': 'Listing truncated (depth/entry limit)',
  'workers.registerTitle': 'Register CLI worker',
  'workers.formName': 'Name',
  'workers.formCommand': 'Command',
  'workers.formArgs': 'Args (space-separated)',
  'workers.formSave': 'Save',
  'chat.openSession': 'Open a session to collaborate',
  'chat.openSessionHint':
    'Pick a session on the left or create one. The Mastra Leader routes by role: plan / coder / review / test CLI workers.',
  'chat.serverDown': 'Mastra is offline (localhost:4111). Run npm run dev:mastra first.',
  'chat.ready': 'Ready',
  'chat.connected': 'connected',
  'chat.offline': 'offline',
  'chat.readyBody':
    'Describe your task. I will read workers and roles (plan/coder/review/test…), plan, and dispatch-worker when needed.',
  'chat.mode': 'Mode',
  'chat.model': 'Model',
  'chat.noModelConfigured': 'No key configured',
  'chat.noModelHint': 'No models available yet. Configure an API key in Settings first.',
  'chat.openSettings': 'Open settings',
  'chat.project': 'Project',
  'chat.path': 'Path',
  'chat.leader': 'Mastra Supervisor',
  'chat.you': 'You',
  'chat.placeholder': 'Describe a task, or name a role/worker… (⌘↵ send)',
  'chat.stop': 'Stop',
  'chat.error': 'Chat error',
  'chat.tool': 'tool',
  'chat.toolError': 'error',
  'chat.thinking': 'Thinking',
  'chat.thinkingLive': 'live…',
  'chat.think.label': 'Thinking intensity',
  'chat.think.short': 'Think',
  'chat.think.hint': 'Controls reasoning budget; tool calls and thinking stay collapsed by default',
  'chat.think.off': 'Off',
  'chat.think.low': 'Low',
  'chat.think.medium': 'Medium',
  'chat.think.high': 'High',
  'chat.think.max': 'Max',
  'mode.ask': 'Ask',
  'mode.plan': 'Plan',
  'mode.build': 'Build',
  'mode.review': 'Review',
  'right.workers': 'Workers',
  'right.jobs': 'Jobs',
  'right.git': 'Git',
  'right.files': 'Files',
  'right.approvals': 'Approvals',
  'right.activity': 'Activity',
  'workers.registered': 'Registered CLIs',
  'workers.register': '+ Register',
  'workers.primary': 'Primary',
  'workers.roles': 'Roles',
  'workers.formHint':
    'Presets: Claude Code (coder), Codex (review), OpenCode (general). Register custom workers with roles via API.',
  'workers.healthHint': 'Click to check whether the command is available',
  'workers.healthAll': 'Check all',
  'workers.healthAllHint': 'Probe all enabled workers',
  'workers.healthDetail': 'Health details',
  'workers.healthNoDetail': 'No details yet. Click the status badge to check.',
  'workers.healthDeep': 'Deep check (start ACP process)',
  'workers.health.healthy': 'Ready',
  'workers.health.unhealthy': 'Unhealthy',
  'workers.health.missing': 'Missing',
  'workers.health.unknown': 'Unknown',
  'workers.busy': 'Busy',
  'workers.model': 'Model',
  'workers.modelDefault': 'Default (CLI)',
  'workers.modelPlaceholder': 'model id, e.g. claude-sonnet-4…',
  'workers.modelFetch': '↻ Load models from ACP…',
  'workers.modelFetchHint': 'Spawn the worker and list models via ACP',
  'workers.modelCurrent': 'Model',
  'workers.modelRefresh': '↻ Refresh model list…',
  'workers.modelLoading': 'Loading from ACP…',
  'workers.modelComboHint': 'Pick a model; choose “Load/Refresh” to fetch via ACP',
  'workers.modelManual': '✎ Enter model id…',
  'jobs.title': 'Worker jobs',
  'jobs.empty': 'No jobs yet. Dispatch below, or let the Leader call dispatch-worker.',
  'jobs.dispatch': 'Dispatch',
  'jobs.dispatchRole': 'Role',
  'jobs.dispatchPlaceholder': 'Describe the task for the worker…',
  'jobs.needSession': 'Open a session before dispatching.',
  'jobs.cancel': 'Cancel',
  'jobs.retry': 'Retry',
  'approvals.empty': 'No pending permissions. ACP permission requests enqueue here.',
  'approvals.pending': 'Pending',
  'approvals.allow': 'Allow',
  'approvals.deny': 'Deny',
  'approvals.cancel': 'Cancel',
  'approvals.demo': 'Demo permission',
  'approvals.resolved': 'Resolved',
  'approvals.worker': 'Worker',
  'approvals.target': 'Target',
  'activity.ready': 'Leader ready · chat via /chat/router-leader',
  'activity.empty': 'No activity yet. Open a project, dispatch work, or resolve approvals.',
  'role.plan': 'Plan',
  'role.coder': 'Coder',
  'role.review': 'Review',
  'role.test': 'Test',
  'role.research': 'Research',
  'role.general': 'General',
  'prompt.sessionTitle': 'Session title',
  'prompt.sessionDefault': 'New task',
  'lang.zh': '中文',
  'lang.en': 'EN',
  'lang.label': 'Language',
  'theme.label': 'Appearance',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'settings.title': 'Settings',
  'settings.subtitle': 'Pick a Leader model and store API keys securely',
  'settings.close': 'Close',
  'settings.save': 'Save & apply',
  'settings.saved': 'Saved. Keys encrypted; model applies to new chats.',
  'settings.security': 'Secure storage',
  'settings.securityHint':
    'API keys are AES-256-GCM encrypted on disk (storage={storage} · {platform}). In Electron the master key is wrapped with OS secure storage (macOS Keychain / Windows DPAPI).',
  'settings.safeStorageOn': 'Electron safeStorage enabled',
  'settings.safeStorageOff': 'safeStorage unavailable — using local encrypted file (mode 600)',
  'settings.model': 'Leader model',
  'settings.modelHint': 'Model ids use provider/model. Catalog curated from models.dev / AI SDK.',
  'settings.provider': 'Provider',
  'settings.leaderModel': 'Model',
  'settings.customModel': 'Custom model id',
  'settings.apiKeys': 'API Keys',
  'settings.filterProviders': 'Filter providers…',
  'settings.enterKey': 'Paste API key',
  'settings.configured': 'Ready',
  'settings.clear': 'Clear',
  'settings.keyCleared': 'Key cleared',
  'settings.tabModel': 'Model',
  'settings.tabProviders': 'Custom providers',
  'settings.tabAbout': 'About',
  'settings.pickProvider': 'Choose provider',
  'settings.pickModel': 'Choose model',
  'settings.thinking': 'Thinking intensity',
  'settings.thinkingHint':
    'Maps to provider reasoning budgets (OpenAI reasoningEffort, Anthropic budget, Gemini thinkingBudget, …). The chat bar can change this and syncs back here.',
  'settings.providerKey': '{provider} API key',
  'settings.needKey': 'Key required',
  'settings.keyReady': 'Key ready',
  'settings.keyRequired': 'This provider has no key yet — add one before chat works.',
  'settings.keyOptionalUpdate': 'Optional: paste a new key to update (leave blank to keep).',
  'settings.updateKey': 'Update key',
  'settings.showCustom': 'Use custom model id…',
  'settings.hideCustom': 'Hide custom id',
  'settings.current': 'Current Leader model',
  'settings.sources': 'Model data sources',
  'settings.modelDocs': 'Model docs',
  'settings.show': 'Show',
  'settings.hide': 'Hide',
  'settings.customIntro':
    'Add a company gateway or third-party API (OpenCode-style). Usually just: name, URL, model, API key.',
  'settings.customEmpty': 'No custom providers yet. Fill in the fields below.',
  'settings.addCustomProvider': 'Add custom provider',
  'settings.editCustom': 'Edit custom provider',
  'settings.customId': 'Provider id',
  'settings.customName': 'Name',
  'settings.customEnv': 'API key env var',
  'settings.customModelId': 'Model',
  'settings.customModelLabel': 'Model label',
  'settings.customDocs': 'Docs URL (optional)',
  'settings.customRequired': 'Name and model are required.',
  'settings.customModelFormat': 'Model id must be provider/model.',
  'settings.customIdTaken': 'That name conflicts with a built-in provider — pick another.',
  'settings.customDrafted': 'Added to list. Click Save & apply at the bottom.',
  'settings.customSaveHint': 'Click “Add to list”, then Save & apply at the bottom.',
  'settings.customBadge': 'Custom',
  'settings.edit': 'Edit',
  'settings.remove': 'Remove',
  'settings.cancelEdit': 'Cancel',
  'settings.updateCustom': 'Update',
  'settings.addToList': 'Add to list',
  'settings.customApiStyle': 'API type',
  'settings.customBaseUrl': 'API base URL',
  'settings.customContext': 'Context length (optional)',
  'settings.customModelContext': 'Model context window (tokens)',
  'settings.customNamePh': 'e.g. Company gateway, SiliconFlow',
  'settings.customBaseUrlHint': 'OpenAI-compatible root URL, usually ends with /v1. Leave blank for official clouds.',
  'settings.customApiStyleHint': 'Most third-party gateways are OpenAI-compatible.',
  'settings.customModelPh': 'e.g. deepseek-chat or gpt-4o',
  'settings.customModelHint': 'Just the model name — no provider/ prefix needed.',
  'settings.customApiKey': 'API Key',
  'settings.customApiKeyPh': 'Paste key (optional; can set later on Model tab)',
  'settings.customApiKeyHint': 'Stored encrypted on this machine. Env var names are auto-generated — you can ignore them.',
  'settings.customContextHint': 'Token context window if you know it; otherwise leave blank.',
  'settings.styleOpenai': 'OpenAI-compatible',
  'settings.styleAnthropic': 'Anthropic',
  'settings.styleGoogle': 'Google',
  'settings.showAdvanced': 'Advanced…',
  'settings.hideAdvanced': 'Hide advanced',
  'right.goals': 'Goals',
  'goals.title': 'Current goal',
  'goals.hint': 'Durable objective: the Leader keeps working until a judge marks it done.',
  'goals.placeholder': 'e.g. Add /health to the API and cover with tests',
  'goals.set': 'Set goal',
  'goals.clear': 'Clear',
  'goals.empty': 'No goal. Set one and the agent will pursue it across turns.',
  'goals.status': 'Status',
  'goals.thread': 'Thread',
}

export const catalogs: Record<Locale, Dict> = { zh, en }

export function roleMessageKey(role: WorkerRole): MessageKey {
  return `role.${role}` as MessageKey
}

export function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
}

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh'
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
