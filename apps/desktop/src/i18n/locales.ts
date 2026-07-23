import type { WorkerRole } from '@swarmdesk-agent/shared'

export type Locale = 'zh' | 'en'

export type MessageKey =
  | 'access.autoEdit'
  | 'access.autoEditDesc'
  | 'access.confirm'
  | 'access.confirmDesc'
  | 'access.full'
  | 'access.fullDesc'
  | 'access.plan'
  | 'access.planDesc'
  | 'app.bannerCmd'
  | 'app.bannerOffline'
  | 'app.loading'
  | 'app.title'
  | 'approvals.cancel'
  | 'approvals.empty'
  | 'approvals.noOptions'
  | 'approvals.pending'
  | 'approvals.target'
  | 'approvals.worker'
  | 'chat.budgetExhausted'
  | 'chat.continueTask'
  | 'chat.ctxCompress'
  | 'chat.ctxCacheHit'
  | 'chat.ctxStats'
  | 'chat.ctxSub'
  | 'chat.ctxTitle'
  | 'chat.ctxUsed'
  | 'chat.error'
  | 'chat.errorBilling'
  | 'chat.errorGeneric'
  | 'chat.errorMissingKey'
  | 'chat.errorModel'
  | 'chat.errorNetwork'
  | 'chat.errorOffline'
  | 'chat.errorOpenBilling'
  | 'chat.greeting'
  | 'chat.greetingNoProject'
  | 'chat.subhead'
  | 'chat.hint.compose'
  | 'chat.hint.capability'
  | 'chat.hint.start'
  | 'chat.inspector'
  | 'chat.inspectorClose'
  | 'chat.leader'
  | 'chat.team'
  | 'chat.defaultTeam'
  | 'chat.teamNeedsMapping'
  | 'chat.model'
  | 'chat.manageModels'
  | 'chat.noModelConfigured'
  | 'chat.noModelHint'
  | 'chat.openSession'
  | 'chat.openSessionHint'
  | 'chat.openProject'
  | 'chat.openFolder'
  | 'chat.openSettings'
  | 'chat.placeholder'
  | 'chat.placeholderHome'
  | 'chat.runElapsed'
  | 'chat.runMeta'
  | 'chat.runPlaceholder'
  | 'chat.runStarted'
  | 'chat.runTzCst'
  | 'chat.running'
  | 'chat.runningShort'
  | 'chat.serverDown'
  | 'chat.serviceOffline'
  | 'chat.serviceOnlineHint'
  | 'chat.stop'
  | 'chat.think.high'
  | 'chat.think.label'
  | 'chat.think.low'
  | 'chat.think.max'
  | 'chat.think.medium'
  | 'chat.think.off'
  | 'chat.think.xhigh'
  | 'chat.thinking'
  | 'chat.thinkingLive'
  | 'chat.tool'
  | 'chat.toolError'
  | 'chat.you'
  | 'common.refresh'
  | 'common.loading'
  | 'files.empty'
  | 'files.error'
  | 'files.noProject'
  | 'files.truncated'
  | 'git.clean'
  | 'git.deletions'
  | 'git.error'
  | 'git.insertions'
  | 'git.noProject'
  | 'git.branchSwitcher.label'
  | 'git.branchSwitcher.trigger.ariaLabel'
  | 'git.branchSwitcher.searchPlaceholder'
  | 'git.branchSwitcher.section.branches'
  | 'git.branchSwitcher.empty'
  | 'git.branchSwitcher.loading'
  | 'git.branchSwitcher.detached'
  | 'git.branchSwitcher.currentDirty'
  | 'git.branchSwitcher.createAction'
  | 'git.branchSwitcher.workerWarning'
  | 'git.branchSwitcher.toast.switchSuccess'
  | 'git.branchSwitcher.toast.createSuccess'
  | 'git.branchSwitcher.createDialog.title'
  | 'git.branchSwitcher.createDialog.description'
  | 'git.branchSwitcher.createDialog.nameLabel'
  | 'git.branchSwitcher.createDialog.placeholder'
  | 'git.branchSwitcher.createDialog.startPointLabel'
  | 'git.branchSwitcher.createDialog.startPointPlaceholder'
  | 'git.branchSwitcher.createDialog.confirm'
  | 'git.branchSwitcher.commitDialog.title'
  | 'git.branchSwitcher.commitDialog.description'
  | 'git.branchSwitcher.commitDialog.messageLabel'
  | 'git.branchSwitcher.commitDialog.confirm'
  | 'git.branchSwitcher.error.tracked-changes-would-be-overwritten'
  | 'git.branchSwitcher.error.untracked-changes-would-be-overwritten'
  | 'git.branchSwitcher.error.conflicts-present'
  | 'git.branchSwitcher.error.operation-in-progress'
  | 'git.branchSwitcher.error.branch-in-other-worktree'
  | 'git.branchSwitcher.error.target-branch-not-found'
  | 'git.branchSwitcher.error.request-failed'
  | 'jobs.cancel'
  | 'jobs.dispatch'
  | 'jobs.dispatchPlaceholder'
  | 'jobs.empty'
  | 'jobs.modelDisabledHint'
  | 'jobs.needSession'
  | 'jobs.retry'
  | 'jobs.title'
  | 'lang.en'
  | 'lang.zh'
  | 'prompt.browse'
  | 'prompt.cancel'
  | 'prompt.noFolder'
  | 'prompt.ok'
  | 'prompt.projectPath'
  | 'prompt.selectFolder'
  | 'layout.resizeSidebar'
  | 'layout.resizeInspector'
  | 'right.approvals'
  | 'right.files'
  | 'right.git'
  | 'right.jobs'
  | 'right.roles'
  | 'right.rolesHint'
  | 'roles.acpDefault'
  | 'roles.add'
  | 'roles.archive'
  | 'roles.edit'
  | 'roles.empty'
  | 'roles.inheritsWorker'
  | 'roles.instructions'
  | 'roles.idle'
  | 'roles.model'
  | 'roles.modelInherit'
  | 'roles.name'
  | 'roles.needSession'
  | 'roles.noWorkers'
  | 'roles.openJobs'
  | 'roles.resetSession'
  | 'roles.confirmResetSession'
  | 'roles.confirmArchive'
  | 'roles.resetBlocked'
  | 'roles.save'
  | 'roles.saved'
  | 'roles.sessionReset'
  | 'roles.type'
  | 'roles.useDefaultPrompt'
  | 'roles.worker'
  | 'roles.workerMissing'
  | 'roles.factWorker'
  | 'roles.factModel'
  | 'roles.archived'
  | 'team.templates'
  | 'team.templatesHint'
  | 'team.savedTemplates'
  | 'team.newTemplate'
  | 'team.templateName'
  | 'team.templateDesc'
  | 'team.saveCurrent'
  | 'team.deleteTemplate'
  | 'team.saveMeta'
  | 'team.overwriteFromCurrent'
  | 'team.checkMappings'
  | 'team.replaceCurrent'
  | 'team.close'
  | 'team.mappingSection'
  | 'team.chooseWorker'
  | 'team.inheritModel'
  | 'team.modelPlaceholder'
  | 'team.openJobsBlock'
  | 'team.savedToast'
  | 'team.updatedToast'
  | 'team.deletedToast'
  | 'team.replacedToast'
  | 'role.coder'
  | 'role.general'
  | 'role.plan'
  | 'role.research'
  | 'role.review'
  | 'role.test'
  | 'settings.aboutBody'
  | 'settings.addProvider'
  | 'settings.addModel'
  | 'settings.addModelBtn'
  | 'settings.addModelInline'
  | 'settings.addToList'
  | 'settings.apiRestartFailed'
  | 'settings.appearance'
  | 'settings.appearanceDesc'
  | 'appearance.system'
  | 'appearance.classic'
  | 'appearance.dark'
  | 'appearance.warm'
  | 'settings.back'
  | 'settings.cancelEdit'
  | 'settings.clear'
  | 'settings.configured'
  | 'settings.enabled'
  | 'settings.disabled'
  | 'settings.enableProvider'
  | 'settings.ctxWindow'
  | 'settings.ctxWindowHint'
  | 'settings.ctxWindowPh'
  | 'settings.current'
  | 'settings.customApiKey'
  | 'settings.customApiKeyHint'
  | 'settings.customApiKeyPh'
  | 'settings.customApiStyle'
  | 'settings.customApiStyleHint'
  | 'settings.customBadge'
  | 'settings.customBaseUrl'
  | 'settings.customBaseUrlHint'
  | 'settings.customDrafted'
  | 'settings.customEmpty'
  | 'settings.customIdTaken'
  | 'settings.customModelAdded'
  | 'settings.customModelHint'
  | 'settings.customModelLast'
  | 'settings.customModelPh'
  | 'settings.customModelRemoved'
  | 'settings.customModelUpdated'
  | 'settings.customModelRequired'
  | 'settings.customModelTaken'
  | 'settings.customName'
  | 'settings.customNamePh'
  | 'settings.customRequired'
  | 'settings.customSaveHint'
  | 'settings.editCustom'
  | 'settings.enterKey'
  | 'settings.hide'
  | 'settings.hideCustom'
  | 'settings.keyCleared'
  | 'settings.keyReplaceHint'
  | 'settings.keySaved'
  | 'settings.keyOptionalUpdate'
  | 'settings.keyReady'
  | 'settings.keyRequired'
  | 'settings.language'
  | 'settings.languageDesc'
  | 'settings.sendShortcut'
  | 'settings.sendShortcutDesc'
  | 'settings.sendShortcutEnter'
  | 'settings.sendShortcutModEnter'
  | 'settings.modelDocs'
  | 'settings.modelId'
  | 'settings.modelNotFeatured'
  | 'settings.modelRegistryUnknown'
  | 'settings.navAbout'
  | 'settings.navGeneral'
  | 'settings.navModel'
  | 'settings.navPrompts'
  | 'settings.navWorkers'
  | 'settings.needKey'
  | 'settings.perModelThinking'
  | 'settings.perModelThinkingHint'
  | 'settings.pickModel'
  | 'settings.firstModelHint'
  | 'settings.modelList'
  | 'settings.removeModel'
  | 'settings.provider'
  | 'settings.providerBuiltin'
  | 'settings.providerCustom'
  | 'settings.providerKey'
  | 'settings.descGeneral'
  | 'settings.descModel'
  | 'settings.descPrompts'
  | 'settings.descWorkers'
  | 'settings.descAbout'
  | 'settings.runtime.leaderMaxSteps'
  | 'settings.runtime.leaderMaxStepsDesc'
  | 'settings.runtime.leaderMaxStepsError'
  | 'settings.runtime.npmRegistry'
  | 'settings.runtime.npmRegistryDesc'
  | 'settings.runtime.npmRegistryUrl'
  | 'settings.runtime.npmRegistryPh'
  | 'settings.runtime.npmRegistryErrorHttps'
  | 'settings.runtime.npmRegistryErrorSpace'
  | 'settings.runtime.saveSuccess'
  | 'settings.runtime.workerTimeouts'
  | 'settings.runtime.workerTimeoutsDesc'
  | 'settings.runtime.workerTimeoutsSave'
  | 'settings.runtime.minutesUnit'
  | 'settings.runtime.stepsUnit'
  | 'settings.runtime.workerJobTimeout'
  | 'settings.runtime.workerJobTimeoutDesc'
  | 'settings.runtime.workerJobTimeoutError'
  | 'settings.runtime.workerApprovalTimeout'
  | 'settings.runtime.workerApprovalTimeoutDesc'
  | 'settings.runtime.workerApprovalTimeoutError'
  | 'settings.runtime.workerQueueTimeout'
  | 'settings.runtime.workerQueueTimeoutDesc'
  | 'settings.runtime.workerQueueTimeoutError'
  | 'settings.prompts.leader'
  | 'settings.prompts.leaderHint'
  | 'settings.prompts.roles'
  | 'settings.prompts.rolesHint'
  | 'settings.prompts.reset'
  | 'settings.prompts.save'
  | 'settings.prompts.saved'
  | 'settings.storageRoot'
  | 'settings.storageData'
  | 'settings.storageCache'
  | 'settings.save'
  | 'settings.saved'
  | 'settings.security'
  | 'settings.securityHint'
  | 'settings.show'
  | 'settings.showCustom'
  | 'settings.styleAnthropic'
  | 'settings.styleGoogle'
  | 'settings.styleOpenai'
  | 'settings.title'
  | 'settings.updateCustom'
  | 'settings.updateKey'
  | 'settings.version'
  | 'sidebar.brand'
  | 'sidebar.confirmDeleteProject'
  | 'sidebar.confirmDeleteSession'
  | 'sidebar.deleteProject'
  | 'sidebar.deleteSession'
  | 'sidebar.empty'
  | 'sidebar.needProjectOpenFolder'
  | 'sidebar.newTask'
  | 'sidebar.noSessions'
  | 'sidebar.now'
  | 'sidebar.relMonth'
  | 'sidebar.relMinutes'
  | 'sidebar.relHours'
  | 'sidebar.relDays'
  | 'sidebar.relWeeks'
  | 'sidebar.openProject'
  | 'sidebar.projects'
  | 'sidebar.renamePlaceholder'
  | 'sidebar.renameSession'
  | 'sidebar.settings'
  | 'sidebar.showMore'
  | 'sidebar.showLess'
  | 'sidebar.statusApprove'
  | 'sidebar.statusDone'
  | 'sidebar.statusError'
  | 'sidebar.statusIdle'
  | 'sidebar.statusRun'
  | 'sidebar.untitledSession'
  | 'theme.dark'
  | 'theme.light'
  | 'theme.system'
  | 'workers.busy'
  | 'workers.cancel'
  | 'workers.empty'
  | 'workers.manualRegistration'
  | 'workers.manualRegistrationHint'
  | 'workers.registerModeAuto'
  | 'workers.registerModeManual'
  | 'workers.formArgs'
  | 'workers.formCommand'
  | 'workers.customLaunchKind'
  | 'workers.customSystemExecutable'
  | 'workers.customLocalExecutable'
  | 'workers.customPackageSpec'
  | 'workers.formEnabled'
  | 'workers.formName'
  | 'workers.formPrimary'
  | 'workers.formRoles'
  | 'workers.formSave'
  | 'workers.health.healthy'
  | 'workers.health.missing'
  | 'workers.health.unhealthy'
  | 'workers.health.unknown'
  | 'workers.authAgent'
  | 'workers.authCancel'
  | 'workers.authConfigureSecrets'
  | 'workers.authFailed'
  | 'workers.authQueued'
  | 'workers.authRunning'
  | 'workers.authSaveSecrets'
  | 'workers.authSecretHint'
  | 'workers.authSucceeded'
  | 'workers.defaultRole'
  | 'workers.defaultRoleInheritsModel'
  | 'workers.healthAll'
  | 'workers.healthAllHint'
  | 'workers.healthDeep'
  | 'workers.healthDetail'
  | 'workers.healthHint'
  | 'workers.healthNoDetail'
  | 'workers.model'
  | 'workers.modelCatalogEmpty'
  | 'workers.modelCatalogStale'
  | 'workers.modelComboHint'
  | 'workers.modelDefault'
  | 'workers.modelFetch'
  | 'workers.modelLoading'
  | 'workers.modelManual'
  | 'workers.modelNeedSelect'
  | 'workers.modelNeedSelectOpenCode'
  | 'workers.modelPlaceholder'
  | 'workers.modelRefresh'
  | 'workers.modelSearch'
  | 'workers.primary'
  | 'workers.register'
  | 'workers.registerTitle'
  | 'workers.registered'
  | 'workers.registryAgent'
  | 'workers.registryAuthRequired'
  | 'workers.registryAgentCount'
  | 'workers.registryBundledAtRelease'
  | 'workers.registryCheckUpdates'
  | 'workers.registryCheckingUpdates'
  | 'workers.registryDetailAuthors'
  | 'workers.registryDetailCommand'
  | 'workers.registryDetailDeclared'
  | 'workers.registryDetailDistribution'
  | 'workers.registryDetailIntegrity'
  | 'workers.registryDetailLicense'
  | 'workers.registryDetailManifest'
  | 'workers.registryDetailObserved'
  | 'workers.registryDetailRepository'
  | 'workers.registryDetailRunner'
  | 'workers.registryDetailSource'
  | 'workers.registryDetailTitle'
  | 'workers.registryDetailWebsite'
  | 'workers.registryDeclaredMissing'
  | 'workers.registryDigestMatch'
  | 'workers.registryDigestMismatch'
  | 'workers.registryEmpty'
  | 'workers.registryHint'
  | 'workers.registryInstalled'
  | 'workers.registryLoading'
  | 'workers.registryLocalInstall'
  | 'workers.registryManifestUnavailable'
  | 'workers.registrySelectionUnavailable'
  | 'workers.registryShowingCount'
  | 'workers.registryNetworkAuthNotice'
  | 'workers.registryNoShaWarning'
  | 'workers.registryNotInstalled'
  | 'workers.registryObservedPending'
  | 'workers.registryPrepareCancel'
  | 'workers.registryPrepareCancelled'
  | 'workers.registryPrepareComplete'
  | 'workers.registryPrepareFailed'
  | 'workers.registryPrepareQueued'
  | 'workers.registryPrepareRetry'
  | 'workers.registryPrepareRunning'
  | 'workers.registryRegistering'
  | 'workers.registryRunnerBinary'
  | 'workers.registryRunnerNpx'
  | 'workers.registryRunnerUvx'
  | 'workers.registryReady'
  | 'workers.registrySandboxNotice'
  | 'workers.registrySearch'
  | 'workers.registrySource'
  | 'workers.registrySourceBundled'
  | 'workers.registrySourcePersisted'
  | 'workers.registryTrustNoSha'
  | 'workers.registryUnavailable'
  | 'workers.registryUpdated'
  | 'workers.registryUpdatedAt'
  | 'workers.registryUpToDate'
  | 'workers.registryUpdateFailed'
  | 'workers.registryUpdateRequired'
  | 'workers.registryOwnerManagedHint'
  | 'workers.runAuthenticate'
  | 'workers.runAuthHint'
  | 'workers.runNoOutput'
  | 'workers.runRestartContext'
  | 'workers.runTruncated'
  | 'workers.terminalCancel'
  | 'workers.terminalClose'
  | 'workers.terminalConnecting'
  | 'workers.terminalFailed'
  | 'workers.terminalOpen'
  | 'workers.terminalReady'
  | 'workers.terminalSucceeded'
  | 'workers.terminalTitle'
  | 'workers.terminalVerifying'
  | 'workers.roles'

type Dict = Record<MessageKey, string>

const zh: Dict = {
  'access.autoEdit': '自动编辑',
  'access.autoEditDesc': '自动编辑文件',
  'access.confirm': '变更前确认',
  'access.confirmDesc': '改文件前先问我',
  'access.full': '完全访问',
  'access.fullDesc': '减少确认次数',
  'access.plan': '计划模式',
  'access.planDesc': '编辑前先出计划',
  'app.bannerCmd': 'npm run dev',
  'app.bannerOffline': '无法连接服务（{error}）。另开终端运行：',
  'app.loading': '加载中…',
  'app.title': 'SwarmDesk',
  'approvals.cancel': '取消',
  'approvals.empty': '暂无待批权限。ACP 权限请求会进入此队列。',
  'approvals.noOptions': 'Agent 未提供可选项',
  'approvals.pending': '待审批',
  'approvals.target': '目标',
  'approvals.worker': 'Worker',
  'chat.budgetExhausted': '已消耗 {used}/{max} 步骤预算，任务可能尚未完成。',
  'chat.continueTask': '继续',
  'chat.ctxCompress': '压缩上下文',
  'chat.ctxCacheHit': '缓存命中率',
  'chat.ctxStats': '{used}/{total} ({pct}%)',
  'chat.ctxSub': '已用 {used}，共 {total}',
  'chat.ctxTitle': '上下文窗口',
  'chat.ctxUsed': '{pct}% 已用',
  'chat.error': '无法完成对话',
  'chat.errorBilling':
    '当前 API 账号余额不足或订阅已失效（不是本地会话残留）。请在提供商控制台续费/换有余额的 Key 后重试。',
  'chat.errorGeneric': '请求失败。详细信息已输出到开发者终端。',
  'chat.errorMissingKey': '尚未配置该模型的 API Key。请到设置中填写后重试。',
  'chat.errorModel': '模型不可用或 id 无效，请在设置中更换模型。',
  'chat.errorNetwork': '无法连接本地服务，请确认 API 已启动。',
  'chat.errorOffline': '服务未连接，请稍后重试。',
  'chat.errorOpenBilling': '打开账单页',
  'chat.greeting': '我们应该在 {project} 中构建什么？',
  'chat.greetingNoProject': '我们应该构建什么？',
  'chat.subhead': '派发多个 Agent Worker 协同完成编码、审查与规划。Leader 统筹，Worker 各司其职。',
  // 空态提示词池（每次进入空态随机轮换一条，含 subhead 共 4 条）
  'chat.hint.compose': '描述任务，Leader 会自动拆解并派发给合适的 Worker。',
  'chat.hint.capability': '实现、审查、规划——告诉我你的目标，我来编排。',
  'chat.hint.start': '从一个问题开始，或描述你想要实现的功能。',
  'chat.inspector': '打开 Inspector',
  'chat.inspectorClose': '关闭 Inspector',
  'chat.leader': 'Supervisor',
  'chat.team': '协作组',
  'chat.defaultTeam': '默认编组',
  'chat.teamNeedsMapping': '需要先在协作组面板修复映射',
  'layout.resizeSidebar': '调整左侧栏宽度',
  'layout.resizeInspector': '调整右侧栏宽度',
  'chat.model': '模型',
  'chat.manageModels': '管理模型',
  'chat.noModelConfigured': '未配置 Key',
  'chat.noModelHint': '还没有可用的模型，请先在设置中配置 API Key。',
  'chat.openSession': '选择左侧 Session，或新建一个。',
  'chat.openSessionHint':
    '选择左侧 Session，或新建一个。Leader 会按角色协调 plan / coder / review / test 等 CLI Worker。',
  'chat.openProject': '打开项目…',
  'chat.openFolder': '打开文件夹',
  'chat.openSettings': '打开设置',
  'chat.placeholder': '描述任务，或指定角色/Worker…（⌘↵ 发送）',
  'chat.placeholderHome': '随心输入…',
  'chat.runElapsed': '耗时',
  'chat.runMeta': '运行信息',
  'chat.runPlaceholder': '—',
  'chat.runStarted': '开始时间',
  'chat.runTzCst': 'CST',
  'chat.running': '● 运行中',
  'chat.runningShort': '运行中',
  'chat.serverDown': '服务未连接，正在尝试重连…',
  'chat.serviceOffline': '● 离线',
  'chat.serviceOnlineHint': '后端服务在线',
  'chat.stop': '停止',
  'chat.think.high': '高',
  'chat.think.label': '思考强度',
  'chat.think.low': '低',
  'chat.think.max': '最高',
  'chat.think.medium': '中',
  'chat.think.off': '关闭',
  'chat.think.xhigh': '极高',
  'chat.thinking': '思考',
  'chat.thinkingLive': '思考中',
  'chat.tool': '工具',
  'chat.toolError': '失败',
  'chat.you': '你',
  'common.refresh': '刷新',
  'common.loading': '加载中…',
  'files.empty': '目录为空',
  'files.error': '无法列出文件',
  'files.noProject': '请先打开项目',
  'files.truncated': '列表已截断（达到深度/数量上限）',
  'git.clean': '工作区干净，无变更。',
  'git.deletions': '删除行',
  'git.error': '无法读取 Git 状态',
  'git.insertions': '新增行',
  'git.noProject': '请先打开项目',
  'git.branchSwitcher.label': '分支',
  'git.branchSwitcher.trigger.ariaLabel': '切换 Git 分支',
  'git.branchSwitcher.searchPlaceholder': '搜索分支',
  'git.branchSwitcher.section.branches': '分支',
  'git.branchSwitcher.empty': '未找到匹配分支',
  'git.branchSwitcher.loading': '读取中…',
  'git.branchSwitcher.detached': '（分离 HEAD）',
  'git.branchSwitcher.currentDirty': '未提交：{count} 个文件',
  'git.branchSwitcher.createAction': '创建并检出新分支…',
  'git.branchSwitcher.workerWarning':
    '当前项目有 {count} 个进行中的任务，切换分支会影响它们看到的代码。是否继续？',
  'git.branchSwitcher.toast.switchSuccess': '已切换到分支 {branchName}',
  'git.branchSwitcher.toast.createSuccess': '已创建并切换到分支 {branchName}',
  'git.branchSwitcher.createDialog.title': '创建新分支',
  'git.branchSwitcher.createDialog.description': '从当前 HEAD 创建并切换到新分支。',
  'git.branchSwitcher.createDialog.nameLabel': '分支名',
  'git.branchSwitcher.createDialog.placeholder': 'feature/my-branch',
  'git.branchSwitcher.createDialog.startPointLabel': '起点（可选）',
  'git.branchSwitcher.createDialog.startPointPlaceholder': 'main / commit-ish',
  'git.branchSwitcher.createDialog.confirm': '创建并切换',
  'git.branchSwitcher.commitDialog.title': '提交并切换',
  'git.branchSwitcher.commitDialog.description': '切换到 {target} 前需要先提交当前改动。',
  'git.branchSwitcher.commitDialog.messageLabel': '提交信息',
  'git.branchSwitcher.commitDialog.confirm': '提交并切换',
  'git.branchSwitcher.error.tracked-changes-would-be-overwritten':
    '本地已跟踪的改动会被覆盖，请先提交或暂存。',
  'git.branchSwitcher.error.untracked-changes-would-be-overwritten': '未跟踪的工作区文件会被覆盖。',
  'git.branchSwitcher.error.conflicts-present': '当前存在未解决的冲突。',
  'git.branchSwitcher.error.operation-in-progress': '另一个 git 进程正在运行，请稍后再试。',
  'git.branchSwitcher.error.branch-in-other-worktree': '该分支已在其它 worktree 检出。',
  'git.branchSwitcher.error.target-branch-not-found': '目标分支不存在。',
  'git.branchSwitcher.error.request-failed': '操作失败，请重试。',
  'jobs.cancel': '取消',
  'jobs.dispatch': '派发任务',
  'jobs.dispatchPlaceholder': '描述要委派给 Worker 的任务…',
  'jobs.empty': '暂无任务。可通过协作组成员派发，或由 Leader 调用 dispatch-team-member。',
  'jobs.modelDisabledHint':
    '模型不可用：请到 Workers 面板为该 Worker 选择可用模型后再重试（勿使用「默认」）。',
  'jobs.needSession': '请先打开一个 Session 再派发。',
  'jobs.retry': '重试',
  'jobs.title': 'Worker 任务',
  'lang.en': 'EN',
  'lang.zh': '中文',
  'prompt.browse': '选择文件夹…',
  'prompt.cancel': '取消',
  'prompt.noFolder': '未能读取文件夹绝对路径。请重试选择，或直接把路径粘贴到输入框。',
  'prompt.ok': '确定',
  'prompt.projectPath': '项目根目录绝对路径',
  'prompt.selectFolder': '选择此文件夹',
  'right.approvals': '审批',
  'right.files': '文件',
  'right.git': 'Git',
  'right.jobs': 'Jobs',
  'right.roles': '协作组',
  'right.rolesHint': '协作组属于当前会话。同一 Worker 可绑定多个成员，各自拥有独立会话与提示词。',
  'roles.acpDefault': 'ACP 默认模型',
  'roles.add': '添加成员',
  'roles.archive': '归档',
  'roles.archived': '成员已归档。',
  'roles.edit': '编辑',
  'roles.empty': '当前会话的协作组还没有成员。',
  'roles.inheritsWorker': '继承 Worker：{model}',
  'roles.instructions': '成员提示词',
  'roles.idle': '空闲',
  'roles.model': '模型覆盖（可选）',
  'roles.modelInherit': '留空以继承 Worker 默认模型',
  'roles.name': '成员名称',
  'roles.needSession': '请先打开一个会话。',
  'roles.noWorkers': '暂无可用 Worker，请先到 Agent Worker 面板安装或注册。',
  'roles.openJobs': '{count} 个进行中任务',
  'roles.resetSession': '重置会话',
  'roles.confirmResetSession':
    '确定重置「{name}」的会话吗？该成员在 Worker 侧的上下文将被清空，且不可撤销。',
  'roles.confirmArchive': '确定归档成员「{name}」吗？归档后将从当前协作组中移除。',
  'roles.resetBlocked': '请先完成或取消此成员的进行中任务。',
  'roles.save': '保存成员',
  'roles.saved': '成员已保存。',
  'roles.sessionReset': '成员会话已重置。',
  'roles.type': '语义类型',
  'roles.useDefaultPrompt': '使用角色默认提示词',
  'roles.worker': '绑定 Worker',
  'roles.workerMissing': 'Worker 不可用',
  'roles.factWorker': '状态',
  'roles.factModel': '模型',
  'team.templates': '编组模板',
  'team.templatesHint':
    '模板保存成员提示词、首选 Worker、角色和模型。应用模板会整组替换当前协作组。',
  'team.savedTemplates': '已保存模板',
  'team.newTemplate': '新建模板',
  'team.templateName': '名称',
  'team.templateDesc': '说明（可选）',
  'team.saveCurrent': '保存为模板',
  'team.deleteTemplate': '删除',
  'team.saveMeta': '保存信息',
  'team.overwriteFromCurrent': '用当前组覆盖',
  'team.checkMappings': '检查映射',
  'team.replaceCurrent': '应用并替换',
  'team.close': '关闭',
  'team.mappingSection': '成员映射',
  'team.chooseWorker': '选择替代 Worker',
  'team.inheritModel': '继承 Worker 默认模型',
  'team.modelPlaceholder': '留空继承 Worker 默认模型',
  'team.openJobsBlock': '有 {count} 个未结束任务，当前不能替换协作组。',
  'team.savedToast': '编组模板已保存。',
  'team.updatedToast': '编组模板已更新。',
  'team.deletedToast': '编组模板已删除。',
  'team.replacedToast': '已替换当前协作组。',
  'role.coder': '编码',
  'role.general': '通用',
  'role.plan': '规划',
  'role.research': '调研',
  'role.review': '审查',
  'role.test': '测试',
  'settings.aboutBody':
    'SwarmDesk 是 macOS 桌面多智能体指挥台：Leader 编排，本机 CLI Workers 经 ACP 执行。',
  'settings.addProvider': '添加供应商',
  'settings.addModel': '添加模型',
  'settings.addModelBtn': '+ 添加',
  'settings.addModelInline': '添加新模型',
  'settings.addToList': '加入列表',
  'settings.apiRestartFailed': '设置已写入，但本地 API 未能重启；当前进程尚未应用新设置。',
  'settings.appearance': '外观',
  'settings.appearanceDesc': '跟随系统时浅色为经典，深色随系统',
  'appearance.system': '跟随系统',
  'appearance.classic': '经典',
  'appearance.dark': '深色',
  'appearance.warm': '暖色',
  'settings.back': '返回工作区',
  'settings.descGeneral': '主题、语言与基础行为。',
  'settings.descModel': '管理模型供应商与 API Key，配置后可在聊天时选择使用。',
  'settings.descPrompts': '设置 Leader 和各类角色在后续任务中使用的默认提示词。',
  'settings.descWorkers': '注册与管理 CLI Worker（Claude Code / Codex / OpenCode 等）。',
  'settings.descAbout': '产品信息与版本。',
  'settings.cancelEdit': '取消编辑',
  'settings.clear': '清除',
  'settings.configured': '已配置',
  'settings.enabled': '已启用',
  'settings.disabled': '已停用',
  'settings.enableProvider': '启用 / 停用此供应商',
  'settings.ctxWindow': '上下文窗口',
  'settings.ctxWindowHint': '支持整数或简写，如 20K、128K、1M',
  'settings.ctxWindowPh': '1M / 200K / 128000',
  'settings.current': '当前选用',
  'settings.customApiKey': 'API Key',
  'settings.customApiKeyHint': '保存在本机加密存储，不会上传。环境变量名由系统自动生成，无需关心。',
  'settings.customApiKeyPh': '粘贴密钥（可选，也可稍后在「模型」里填）',
  'settings.customApiStyle': '接口类型',
  'settings.customApiStyleHint': '绝大多数第三方网关选「OpenAI 兼容」即可。',
  'settings.customBadge': '自定义',
  'settings.customBaseUrl': 'Base URL',
  'settings.customBaseUrlHint': 'OpenAI 兼容接口的根地址，一般以 /v1 结尾。官方云服务可留空。',
  'settings.customDrafted': '已加入列表。点「保存」生效。',
  'settings.customEmpty': '该服务商还没有模型，点击下方添加。',
  'settings.customIdTaken': '该名称与内置 Provider 冲突，请换一个名字。',
  'settings.customModelAdded': '模型已添加。',
  'settings.customModelHint': '填模型名即可，将自动加服务商前缀拼为 provider/model。',
  'settings.customModelLast': '每个服务商至少需要保留 1 个模型。',
  'settings.customModelPh': '例如 deepseek-chat 或 gpt-4o',
  'settings.customModelRemoved': '模型已删除。',
  'settings.customModelUpdated': '模型已更新。',
  'settings.customModelRequired': '请至少添加一个模型。',
  'settings.customModelTaken': '该模型已存在，请换一个名字。',
  'settings.customName': '名称',
  'settings.customNamePh': '例如：公司网关、硅基流动',
  'settings.customRequired': '请填写服务商名称。',
  'settings.customSaveHint': '加入列表后，记得点「保存」。',
  'settings.editCustom': '编辑网关',
  'settings.enterKey': '粘贴 API Key',
  'settings.hide': '隐藏',
  'settings.hideCustom': '收起手动输入',
  'settings.keyCleared': '密钥已清除',
  'settings.keyReplaceHint':
    '已配置密钥。要更换请在此粘贴新 Key 后点保存；留空则只保存其它设置、不会改密钥。',
  'settings.keySaved': '密钥已保存并加密。回到对话发送下一条消息时将使用新密钥。',
  'settings.keyOptionalUpdate': 'Key 已保存。要更换时再粘贴新值。',
  'settings.keyReady': 'Key 已就绪',
  'settings.keyRequired': '保存前请粘贴 API Key，否则无法调用此提供方。',
  'settings.language': '语言',
  'settings.languageDesc': '界面显示语言',
  'settings.sendShortcut': '发送快捷键',
  'settings.sendShortcutDesc': '输入框中发送消息的快捷键',
  'settings.sendShortcutEnter': 'Enter',
  'settings.sendShortcutModEnter': '⌘/Ctrl+Enter',
  'settings.modelDocs': '文档',
  'settings.modelId': '模型 id',
  'settings.modelNotFeatured': '非精选',
  'settings.modelRegistryUnknown': '未登记',
  'settings.navAbout': '关于',
  'settings.navGeneral': '常规',
  'settings.navModel': '模型设置',
  'settings.navPrompts': '提示词',
  'settings.navWorkers': 'Agent Worker',
  'settings.needKey': '未配置 Key',
  'settings.perModelThinking': '支持的思考强度',
  'settings.perModelThinkingHint': '仅本模型：勾选可选档位；聊天栏选中该模型时只显示已勾选档位。',
  'settings.pickModel': '模型',
  'settings.modelList': '模型列表',
  'settings.removeModel': '删除模型',
  'settings.firstModelHint': '至少添加一个模型才能创建服务商。保存后可在浏览态继续添加更多。',
  'settings.provider': '提供方',
  'settings.providerBuiltin': '内置',
  'settings.providerCustom': '自定义供应商',
  'settings.providerKey': '{provider} API Key',
  'settings.runtime.leaderMaxSteps': 'Leader 步数预算',
  'settings.runtime.leaderMaxStepsDesc': '单次任务可执行的最大步数，默认 500',
  'settings.runtime.leaderMaxStepsError': '请输入 10 到 1000 之间的整数',
  'settings.runtime.npmRegistry': 'npm 镜像',
  'settings.runtime.npmRegistryDesc': 'npx 拉包使用的 registry；留空用系统默认。',
  'settings.runtime.npmRegistryUrl': 'Registry URL',
  'settings.runtime.npmRegistryPh': 'https://registry.npmmirror.com',
  'settings.runtime.npmRegistryErrorHttps': '必须以 https:// 开头',
  'settings.runtime.npmRegistryErrorSpace': '不能包含空格等非法字符',
  'settings.runtime.saveSuccess': '运行设置已保存',
  'settings.runtime.workerTimeouts': '运行时',
  'settings.runtime.workerTimeoutsDesc': 'Leader 步数预算与 Worker 超时（分钟）。',
  'settings.runtime.workerTimeoutsSave': '保存',
  'settings.runtime.minutesUnit': '分钟',
  'settings.runtime.stepsUnit': '步',
  'settings.runtime.workerJobTimeout': 'Worker 任务超时',
  'settings.runtime.workerJobTimeoutDesc': '进入运行状态后的总执行时间，默认 10 分钟。',
  'settings.runtime.workerJobTimeoutError': '请输入 1 到 120 之间的整数',
  'settings.runtime.workerApprovalTimeout': '人工审批超时',
  'settings.runtime.workerApprovalTimeoutDesc': '等待用户处理 ACP 权限请求的时间，默认 2 分钟。',
  'settings.runtime.workerApprovalTimeoutError': '请输入 1 到 60 之间的整数',
  'settings.runtime.workerQueueTimeout': 'Worker 排队超时',
  'settings.runtime.workerQueueTimeoutDesc': '等待并发槽或 ACP Session 容量的时间，默认 10 分钟。',
  'settings.runtime.workerQueueTimeoutError': '请输入 1 到 120 之间的整数',
  'settings.prompts.leader': 'Leader',
  'settings.prompts.leaderHint': '此内容会附加在内置协议和工具约束之后，从下一轮对话开始生效。',
  'settings.prompts.roles': '角色默认提示词',
  'settings.prompts.rolesHint':
    '用于新会话的协作组成员，以及成员编辑器中的“使用角色默认提示词”；不会覆盖已有成员。',
  'settings.prompts.reset': '恢复默认',
  'settings.prompts.save': '保存',
  'settings.prompts.saved': '提示词已保存，将用于后续新建协作组成员和下一轮 Leader 对话。',
  'settings.storageRoot': '配置目录',
  'settings.storageData': '数据目录',
  'settings.storageCache': '缓存目录',
  'settings.save': '保存',
  'settings.saved': '已保存。密钥已加密，模型将用于新对话。',
  'settings.security': '安全存储',
  'settings.securityHint':
    'API Key 使用 AES-256-GCM 加密写入本机（storage={storage} · {platform}）。主密钥由本机账户标识派生，不写入磁盘、不访问系统钥匙串。',
  'settings.show': '显示',
  'settings.showCustom': '手动输入 model id…',
  'settings.styleAnthropic': 'Anthropic',
  'settings.styleGoogle': 'Google',
  'settings.styleOpenai': 'OpenAI 兼容',
  'settings.title': '设置',
  'settings.updateCustom': '更新',
  'settings.updateKey': '更换 Key',
  'settings.version': '版本',
  'sidebar.brand': 'SwarmDesk',
  'sidebar.confirmDeleteProject': '删除项目「{name}」及其全部 Session？此操作不可撤销。',
  'sidebar.confirmDeleteSession': '删除 Session「{title}」？此操作不可撤销。',
  'sidebar.deleteProject': '删除项目',
  'sidebar.deleteSession': '删除 Session',
  'sidebar.empty': '还没有项目。请「打开项目」并输入本地目录路径。',
  'sidebar.needProjectOpenFolder': '请先打开项目。3 秒后将自动打开文件夹…',
  'sidebar.newTask': '新建任务',
  'sidebar.noSessions': '暂无 Session',
  'sidebar.now': '现在',
  'sidebar.relMinutes': '{count} 分钟前',
  'sidebar.relHours': '{count} 小时前',
  'sidebar.relDays': '{count} 天前',
  'sidebar.relWeeks': '{count} 周前',
  'sidebar.relMonth': '1 个月前',
  'sidebar.openProject': '打开项目',
  'sidebar.projects': '项目',
  'sidebar.renamePlaceholder': '输入新的 Session 标题',
  'sidebar.renameSession': '重命名 Session',
  'sidebar.settings': '设置',
  'sidebar.showMore': '展开 {count} 个',
  'sidebar.showLess': '收起',
  'sidebar.statusApprove': '需要授权',
  'sidebar.statusDone': '已完成',
  'sidebar.statusError': '响应报错',
  'sidebar.statusIdle': '空闲',
  'sidebar.statusRun': '正在执行',
  'sidebar.untitledSession': '新会话',
  'theme.dark': '深色',
  'theme.light': '浅色',
  'theme.system': '系统',
  'workers.busy': '忙碌',
  'workers.cancel': '取消',
  'workers.empty': '尚未安装或注册 Worker。请从 Registry 手动安装，或注册自定义 ACP。',
  'workers.manualRegistration': '手动注册',
  'workers.manualRegistrationHint':
    '填写自定义 ACP 启动方式与命令；不经 Registry 准备，由本机直接启动。',
  'workers.registerModeAuto': '自动注册',
  'workers.registerModeManual': '手动注册',
  'workers.formArgs': '参数（空格分隔）',
  'workers.formCommand': '命令',
  'workers.customLaunchKind': '自定义 ACP 启动方式',
  'workers.customSystemExecutable': '系统 PATH 可执行文件',
  'workers.customLocalExecutable': '本地绝对路径',
  'workers.customPackageSpec': '包名与版本',
  'workers.formEnabled': '启用',
  'workers.formName': '名称',
  'workers.formPrimary': '主角色',
  'workers.formRoles': '可兼角色',
  'workers.formSave': '保存',
  'workers.health.healthy': '可用',
  'workers.health.missing': '未安装',
  'workers.health.unhealthy': '异常',
  'workers.health.unknown': '未检查',
  'workers.authAgent': '开始 Agent 认证',
  'workers.authCancel': '取消认证',
  'workers.authConfigureSecrets': '配置认证变量',
  'workers.authFailed': '认证失败',
  'workers.authQueued': '认证任务排队中…',
  'workers.authRunning': '正在等待 Agent 认证…',
  'workers.authSaveSecrets': '保存并重新验证',
  'workers.authSecretHint':
    '密钥值只发送给 Owner 的 Worker secret store，不会进入 snapshot、Job 或 Activity。',
  'workers.authSucceeded': '认证完成，Worker 已就绪',
  'workers.defaultRole': '默认角色',
  'workers.defaultRoleInheritsModel': '模型继承 Worker 默认模型',
  'workers.healthAll': '全部检查',
  'workers.healthAllHint': '检查所有已启用 Worker 的可用性',
  'workers.healthDeep': '深度检查（启动 ACP 进程）',
  'workers.healthDetail': '健康详情',
  'workers.healthHint': '点击检查命令是否可用',
  'workers.healthNoDetail': '暂无详情。点击状态徽章进行检查。',
  'workers.model': '模型',
  'workers.modelCatalogEmpty': '无目录',
  'workers.modelCatalogStale': '目录过期',
  'workers.modelComboHint': '选择模型；选「加载/更新列表」会启动 ACP 拉取',
  'workers.modelDefault': '默认（CLI）',
  'workers.modelFetch': '↻ 从 ACP 加载模型列表…',
  'workers.modelLoading': '正在从 ACP 加载…',
  'workers.modelManual': '✎ 手动输入 model id…',
  'workers.modelNeedSelect':
    '⚠ 请选择可用模型。CLI 默认模型可能被禁用（Model is disabled），派发任务前务必点选列表中的模型。',
  'workers.modelNeedSelectOpenCode':
    '⚠ OpenCode 默认模型常不可用。请先「加载模型列表」，再选择 Zen 免费模型（如 Big Pickle），不要留在「默认（CLI）」。',
  'workers.modelPlaceholder': 'model id，如 claude-sonnet-4…',
  'workers.modelRefresh': '↻ 更新模型列表…',
  'workers.modelSearch': '搜索模型…',
  'workers.primary': '主角色',
  'workers.register': '＋ 注册',
  'workers.registerTitle': '注册 CLI Worker',
  'workers.registered': '已注册 CLI',
  'workers.registryAgent': 'ACP Registry Agent',
  'workers.registryAgentCount': 'Agent 数量',
  'workers.registryAuthRequired': '需要认证',
  'workers.registryBundledAtRelease': '随应用发布',
  'workers.registryCheckUpdates': '检查更新',
  'workers.registryCheckingUpdates': '正在检查…',
  'workers.registryDetailAuthors': '作者',
  'workers.registryDetailCommand': '启动命令投影',
  'workers.registryDetailDeclared': '声明 SHA-256',
  'workers.registryDetailDistribution': '分发方式',
  'workers.registryDetailIntegrity': '完整性',
  'workers.registryDetailLicense': '许可证',
  'workers.registryDetailManifest': 'Manifest',
  'workers.registryDetailObserved': '实测 SHA-256',
  'workers.registryDetailRepository': '代码仓库',
  'workers.registryDetailRunner': '本机前置条件',
  'workers.registryDetailSource': '包 / 下载来源',
  'workers.registryDetailTitle': 'Registry Agent 详情与信任确认',
  'workers.registryDetailWebsite': '网站',
  'workers.registryDeclaredMissing': '未声明',
  'workers.registryDigestMatch': '一致',
  'workers.registryDigestMismatch': '不一致',
  'workers.registryEmpty': '没有匹配的 Agent',
  'workers.registryHint':
    '从 ACP Registry 搜索并选择 Agent；由 Owner 按受信目录准备并生成启动命令。',
  'workers.registryInstalled': '已安装',
  'workers.registryLoading': '正在加载 ACP Registry…',
  'workers.registryLocalInstall': '需本机安装',
  'workers.registryManifestUnavailable':
    '此 Registry 条目缺少可验证的 manifest digest，无法由 Owner 准备；请刷新目录或升级应用。',
  'workers.registrySelectionUnavailable':
    '所选 Registry 条目已不可用，无法按自定义 Worker 保存；请重新选择或刷新目录。',
  'workers.registryShowingCount': '{shown} / {total}',
  'workers.registryNetworkAuthNotice':
    '准备过程可能访问所选包或下载来源；认证需求会在 ACP initialize 后协商。',
  'workers.registryNoShaWarning': '没有声明 SHA-256；必须显式信任当前 manifest 才能准备。',
  'workers.registryNotInstalled': '未安装',
  'workers.registryObservedPending': '准备后可见',
  'workers.registryPrepareCancel': '取消准备',
  'workers.registryPrepareCancelled': '准备已取消',
  'workers.registryPrepareComplete': '准备完成',
  'workers.registryPrepareFailed': '准备失败',
  'workers.registryPrepareQueued': '等待准备…',
  'workers.registryPrepareRetry': '重试',
  'workers.registryPrepareRunning': '正在准备 Agent…',
  'workers.registryRegistering': '正在注册 Worker…',
  'workers.registryRunnerBinary': '受信 binary 安装目录（无需系统 runner）',
  'workers.registryRunnerNpx': '需要 Node.js 和 npx',
  'workers.registryRunnerUvx': '需要 uv 和 uvx',
  'workers.registryReady': '可派发',
  'workers.registrySandboxNotice': 'Agent 是本机进程，并非安全沙箱；请仅准备你信任的版本和来源。',
  'workers.registrySearch': '搜索 Agent 名称或 ID…',
  'workers.registrySource': '来源',
  'workers.registrySourceBundled': '应用内置',
  'workers.registrySourcePersisted': '本地更新',
  'workers.registryTrustNoSha': '信任此精确 manifest 及准备时观测到的 digest',
  'workers.registryUnavailable': '当前不可用',
  'workers.registryUpdated': 'ACP Registry 已更新。',
  'workers.registryUpdatedAt': '更新时间',
  'workers.registryUpToDate': 'ACP Registry 已是最新版本。',
  'workers.registryUpdateFailed': '检查 ACP Registry 更新失败，继续使用当前目录。',
  'workers.registryUpdateRequired': 'Registry schema 需要更新应用后才能使用。',
  'workers.registryOwnerManagedHint':
    'Registry Agent 由 Owner 准备安装并生成启动命令；不在此编辑命令。',
  'workers.runAuthenticate': '去认证',
  'workers.runAuthHint': '{name}（{identity}）需要完成认证后才能派发。',
  'workers.runNoOutput': '已完成（无输出）',
  'workers.runRestartContext': '重新开始该 Agent 上下文',
  'workers.runTruncated': '输出已截断',
  'workers.terminalCancel': '取消并关闭',
  'workers.terminalClose': '关闭认证终端',
  'workers.terminalConnecting': '正在连接受控终端…',
  'workers.terminalFailed': '认证未完成',
  'workers.terminalOpen': '打开认证终端',
  'workers.terminalReady': '终端已连接',
  'workers.terminalSucceeded': '认证完成，Worker 已就绪',
  'workers.terminalTitle': 'Agent 终端认证',
  'workers.terminalVerifying': '正在重新验证 ACP readiness…',
  'workers.roles': '角色',
}

const en: Dict = {
  'access.autoEdit': 'Auto edit',
  'access.autoEditDesc': 'Edit files automatically',
  'access.confirm': 'Confirm changes',
  'access.confirmDesc': 'Ask before editing files',
  'access.full': 'Full access',
  'access.fullDesc': 'Fewer confirmations',
  'access.plan': 'Plan mode',
  'access.planDesc': 'Plan before edits',
  'app.bannerCmd': 'npm run dev',
  'app.bannerOffline': 'Cannot reach service ({error}). In another terminal run:',
  'app.loading': 'loading…',
  'app.title': 'SwarmDesk',
  'approvals.cancel': 'Cancel',
  'approvals.empty': 'No pending permissions. ACP permission requests enqueue here.',
  'approvals.noOptions': 'Agent provided no options',
  'approvals.pending': 'Pending',
  'approvals.target': 'Target',
  'approvals.worker': 'Worker',
  'chat.budgetExhausted': '{used}/{max} step budget exhausted. Task may be incomplete.',
  'chat.continueTask': 'Continue',
  'chat.ctxCompress': 'Compress context',
  'chat.ctxCacheHit': 'Cache hit rate',
  'chat.ctxStats': '{used}/{total} ({pct}%)',
  'chat.ctxSub': 'Used {used} of {total}',
  'chat.ctxTitle': 'Context window',
  'chat.ctxUsed': '{pct}% used',
  'chat.error': 'Could not complete chat',
  'chat.errorBilling':
    'This API account has insufficient balance or an inactive subscription (not a local session glitch). Top up or switch to a funded key, then retry.',
  'chat.errorGeneric': 'Request failed. Details were logged to the developer console.',
  'chat.errorMissingKey': 'No API key for this model. Add one in Settings and try again.',
  'chat.errorModel': 'Model unavailable or invalid. Pick another in Settings.',
  'chat.errorNetwork': 'Cannot reach the local API. Make sure it is running.',
  'chat.errorOffline': 'Service is offline. Please retry shortly.',
  'chat.errorOpenBilling': 'Open billing',
  'chat.greeting': 'What should we build in {project}?',
  'chat.greetingNoProject': 'What should we build?',
  'chat.subhead':
    'Dispatch multiple Agent Workers to collaborate on coding, review, and planning. Leader orchestrates, Workers each play their part.',
  // Empty-state hint pool (rotates randomly on each entry, 4 total incl. subhead)
  'chat.hint.compose':
    'Describe a task — Leader will break it down and dispatch to the right Workers.',
  'chat.hint.capability': 'Implement, review, plan — tell me your goal and I will orchestrate.',
  'chat.hint.start': 'Start with a question, or describe the feature you want to build.',
  'chat.inspector': 'Open Inspector',
  'chat.inspectorClose': 'Close Inspector',
  'chat.leader': 'Supervisor',
  'chat.team': 'Crew',
  'chat.defaultTeam': 'Default crew',
  'chat.teamNeedsMapping': 'Fix mappings in the Crew panel first',
  'layout.resizeSidebar': 'Resize left sidebar',
  'layout.resizeInspector': 'Resize inspector',
  'chat.model': 'Model',
  'chat.manageModels': 'Manage models',
  'chat.noModelConfigured': 'No key configured',
  'chat.noModelHint': 'No models available yet. Configure an API key in Settings first.',
  'chat.openSession': 'Pick a session on the left or create one.',
  'chat.openSessionHint':
    'Pick a session on the left or create one. The Leader routes by role: plan / coder / review / test CLI workers.',
  'chat.openProject': 'Open Project…',
  'chat.openFolder': 'Open Folder',
  'chat.openSettings': 'Open settings',
  'chat.placeholder': 'Describe a task, or name a role/worker… (⌘↵ send)',
  'chat.placeholderHome': 'Ask anything…',
  'chat.runElapsed': 'Elapsed',
  'chat.runMeta': 'Run info',
  'chat.runPlaceholder': '—',
  'chat.runStarted': 'Started',
  'chat.runTzCst': 'CST',
  'chat.running': '● Running',
  'chat.runningShort': 'Running',
  'chat.serverDown': 'Service is offline, reconnecting…',
  'chat.serviceOffline': '● Offline',
  'chat.serviceOnlineHint': 'Backend service is online',
  'chat.stop': 'Stop',
  'chat.think.high': 'High',
  'chat.think.label': 'Thinking intensity',
  'chat.think.low': 'Low',
  'chat.think.max': 'Max',
  'chat.think.medium': 'Medium',
  'chat.think.off': 'Off',
  'chat.think.xhigh': 'Extra high',
  'chat.thinking': 'Thinking',
  'chat.thinkingLive': 'Thinking',
  'chat.tool': 'tool',
  'chat.toolError': 'error',
  'chat.you': 'You',
  'common.refresh': 'Refresh',
  'common.loading': 'Loading…',
  'files.empty': 'Directory is empty',
  'files.error': 'Could not list files',
  'files.noProject': 'Open a project first',
  'files.truncated': 'Listing truncated (depth/entry limit)',
  'git.clean': 'Working tree clean.',
  'git.deletions': 'deletions',
  'git.error': 'Could not read git status',
  'git.insertions': 'insertions',
  'git.noProject': 'Open a project first',
  'git.branchSwitcher.label': 'Branch',
  'git.branchSwitcher.trigger.ariaLabel': 'Switch Git branch',
  'git.branchSwitcher.searchPlaceholder': 'Search branches',
  'git.branchSwitcher.section.branches': 'Branches',
  'git.branchSwitcher.empty': 'No matching branches',
  'git.branchSwitcher.loading': 'Reading…',
  'git.branchSwitcher.detached': '(detached HEAD)',
  'git.branchSwitcher.currentDirty': '{count} uncommitted file(s)',
  'git.branchSwitcher.createAction': 'Create and checkout new branch…',
  'git.branchSwitcher.workerWarning':
    'This project has {count} running job(s). Switching branches will change the code they see. Continue?',
  'git.branchSwitcher.toast.switchSuccess': 'Switched to branch {branchName}',
  'git.branchSwitcher.toast.createSuccess': 'Created and switched to {branchName}',
  'git.branchSwitcher.createDialog.title': 'Create new branch',
  'git.branchSwitcher.createDialog.description':
    'Create and checkout a new branch from current HEAD.',
  'git.branchSwitcher.createDialog.nameLabel': 'Branch name',
  'git.branchSwitcher.createDialog.placeholder': 'feature/my-branch',
  'git.branchSwitcher.createDialog.startPointLabel': 'Start point (optional)',
  'git.branchSwitcher.createDialog.startPointPlaceholder': 'main / commit-ish',
  'git.branchSwitcher.createDialog.confirm': 'Create and switch',
  'git.branchSwitcher.commitDialog.title': 'Commit and switch',
  'git.branchSwitcher.commitDialog.description':
    'Commit current changes before switching to {target}.',
  'git.branchSwitcher.commitDialog.messageLabel': 'Commit message',
  'git.branchSwitcher.commitDialog.confirm': 'Commit and switch',
  'git.branchSwitcher.error.tracked-changes-would-be-overwritten':
    'Local tracked changes would be overwritten. Commit or stash first.',
  'git.branchSwitcher.error.untracked-changes-would-be-overwritten':
    'Untracked working tree files would be overwritten.',
  'git.branchSwitcher.error.conflicts-present': 'Unresolved conflicts in the index.',
  'git.branchSwitcher.error.operation-in-progress':
    'Another git process is running. Try again shortly.',
  'git.branchSwitcher.error.branch-in-other-worktree':
    'Branch is already checked out in another worktree.',
  'git.branchSwitcher.error.target-branch-not-found': 'Target branch does not exist.',
  'git.branchSwitcher.error.request-failed': 'Operation failed. Please retry.',
  'jobs.cancel': 'Cancel',
  'jobs.dispatch': 'Dispatch',
  'jobs.dispatchPlaceholder': 'Describe the task for the worker…',
  'jobs.empty':
    'No jobs yet. Dispatch through a crew member, or let the Leader call dispatch-team-member.',
  'jobs.modelDisabledHint':
    'Model unavailable: open Workers, select a working model for this worker, then retry (do not use Default).',
  'jobs.needSession': 'Open a session before dispatching.',
  'jobs.retry': 'Retry',
  'jobs.title': 'Worker jobs',
  'lang.en': 'EN',
  'lang.zh': '中文',
  'prompt.browse': 'Browse…',
  'prompt.cancel': 'Cancel',
  'prompt.noFolder': 'No path received. Pick a folder and click Open, or paste a path.',
  'prompt.ok': 'OK',
  'prompt.projectPath': 'Absolute path to project root',
  'prompt.selectFolder': 'Select this folder',
  'right.approvals': 'Approvals',
  'right.files': 'Files',
  'right.git': 'Git',
  'right.jobs': 'Jobs',
  'right.roles': 'Crew',
  'right.rolesHint':
    'The crew belongs to this session. One Worker may back multiple members with isolated sessions and prompts.',
  'roles.acpDefault': 'ACP default model',
  'roles.add': 'Add member',
  'roles.archive': 'Archive',
  'roles.archived': 'Member archived.',
  'roles.edit': 'Edit',
  'roles.empty': 'This session crew has no members yet.',
  'roles.inheritsWorker': 'Inherits Worker: {model}',
  'roles.instructions': 'Member prompt',
  'roles.idle': 'Idle',
  'roles.model': 'Model override (optional)',
  'roles.modelInherit': 'Leave empty to inherit the Worker default model',
  'roles.name': 'Member name',
  'roles.needSession': 'Open a session first.',
  'roles.noWorkers': 'No Worker is available. Install or register one in Agent Worker settings.',
  'roles.openJobs': '{count} open jobs',
  'roles.resetSession': 'Reset session',
  'roles.confirmResetSession':
    'Reset the session for “{name}”? This clears the member’s Worker-side context and cannot be undone.',
  'roles.confirmArchive':
    'Archive member “{name}”? It will be removed from the current crew.',
  'roles.resetBlocked': 'Finish or cancel this member’s open jobs first.',
  'roles.save': 'Save member',
  'roles.saved': 'Member saved.',
  'roles.sessionReset': 'Member session reset.',
  'roles.type': 'Semantic type',
  'roles.useDefaultPrompt': 'Use role default prompt',
  'roles.worker': 'Worker binding',
  'roles.workerMissing': 'Worker unavailable',
  'roles.factWorker': 'Status',
  'roles.factModel': 'Model',
  'team.templates': 'Crew templates',
  'team.templatesHint':
    'Templates preserve member prompts, preferred Workers, roles, and models. Applying replaces the whole crew.',
  'team.savedTemplates': 'Saved templates',
  'team.newTemplate': 'New template',
  'team.templateName': 'Name',
  'team.templateDesc': 'Description (optional)',
  'team.saveCurrent': 'Save as template',
  'team.deleteTemplate': 'Delete',
  'team.saveMeta': 'Save info',
  'team.overwriteFromCurrent': 'Overwrite from crew',
  'team.checkMappings': 'Check mappings',
  'team.replaceCurrent': 'Apply & replace',
  'team.close': 'Close',
  'team.mappingSection': 'Member mappings',
  'team.chooseWorker': 'Choose substitute Worker',
  'team.inheritModel': 'Inherit Worker default model',
  'team.modelPlaceholder': 'Leave blank to inherit Worker model',
  'team.openJobsBlock': '{count} open jobs block crew replacement.',
  'team.savedToast': 'Crew template saved.',
  'team.updatedToast': 'Crew template updated.',
  'team.deletedToast': 'Crew template deleted.',
  'team.replacedToast': 'Current crew replaced.',
  'role.coder': 'Coder',
  'role.general': 'General',
  'role.plan': 'Plan',
  'role.research': 'Research',
  'role.review': 'Review',
  'role.test': 'Test',
  'settings.aboutBody':
    'SwarmDesk is a macOS multi-agent console: the Leader orchestrates, local CLI workers run via ACP.',
  'settings.addProvider': 'Add provider',
  'settings.addModel': 'Add model',
  'settings.addModelBtn': '+ Add',
  'settings.addModelInline': 'Add new model',
  'settings.addToList': 'Add to list',
  'settings.apiRestartFailed':
    'Settings were written, but the local API could not restart and has not applied them yet.',
  'settings.appearance': 'Appearance',
  'settings.appearanceDesc': 'System uses classic for light; dark follows OS when System',
  'appearance.system': 'System',
  'appearance.classic': 'Classic',
  'appearance.dark': 'Dark',
  'appearance.warm': 'Warm',
  'settings.back': 'Back to workspace',
  'settings.descGeneral': 'Theme, language, and basic behavior.',
  'settings.descModel': 'Manage model providers and API keys for chat.',
  'settings.descPrompts': 'Set the default Leader and role prompts used for future tasks.',
  'settings.descWorkers': 'Register and manage CLI workers (Claude Code / Codex / OpenCode).',
  'settings.descAbout': 'Product info and version.',
  'settings.cancelEdit': 'Cancel',
  'settings.clear': 'Clear',
  'settings.configured': 'Ready',
  'settings.enabled': 'Enabled',
  'settings.disabled': 'Disabled',
  'settings.enableProvider': 'Enable / disable this provider',
  'settings.ctxWindow': 'Context window',
  'settings.ctxWindowHint': 'Integer or shorthand like 20K, 128K, 1M',
  'settings.ctxWindowPh': '1M / 200K / 128000',
  'settings.current': 'Selected',
  'settings.customApiKey': 'API Key',
  'settings.customApiKeyHint':
    'Stored encrypted on this machine. Env var names are auto-generated — you can ignore them.',
  'settings.customApiKeyPh': 'Paste key (optional; can set later on Model tab)',
  'settings.customApiStyle': 'API type',
  'settings.customApiStyleHint': 'Most third-party gateways are OpenAI-compatible.',
  'settings.customBadge': 'Custom',
  'settings.customBaseUrl': 'Base URL',
  'settings.customBaseUrlHint':
    'OpenAI-compatible root URL, usually ends with /v1. Leave blank for official clouds.',
  'settings.customDrafted': 'Added to list. Click Save to persist.',
  'settings.customEmpty': 'No models yet — add one below.',
  'settings.customIdTaken': 'That name conflicts with a built-in provider — pick another.',
  'settings.customModelAdded': 'Model added.',
  'settings.customModelHint': 'Model name only; auto-prefixed as provider/model.',
  'settings.customModelLast': 'A provider must keep at least 1 model.',
  'settings.customModelPh': 'e.g. deepseek-chat or gpt-4o',
  'settings.customModelRemoved': 'Model removed.',
  'settings.customModelUpdated': 'Model updated.',
  'settings.customModelRequired': 'Please add at least one model.',
  'settings.customModelTaken': 'That model already exists — pick another.',
  'settings.customName': 'Name',
  'settings.customNamePh': 'e.g. Company gateway, SiliconFlow',
  'settings.customRequired': 'Provider name is required.',
  'settings.customSaveHint': 'After adding to the list, click Save.',
  'settings.editCustom': 'Edit gateway',
  'settings.enterKey': 'Paste API key',
  'settings.hide': 'Hide',
  'settings.hideCustom': 'Hide manual id',
  'settings.keyCleared': 'Key cleared',
  'settings.keyReplaceHint':
    'A key is already configured. Paste a new key here and Save to replace it; leave blank to keep the existing key.',
  'settings.keySaved': 'Key saved and encrypted. The next message in chat will use the new key.',
  'settings.keyOptionalUpdate': 'Key is stored. Paste a new value only to replace it.',
  'settings.keyReady': 'Key ready',
  'settings.keyRequired': 'Paste an API key before this provider will work.',
  'settings.language': 'Language',
  'settings.languageDesc': 'UI language',
  'settings.sendShortcut': 'Send shortcut',
  'settings.sendShortcutDesc': 'Keyboard shortcut to send from the composer',
  'settings.sendShortcutEnter': 'Enter',
  'settings.sendShortcutModEnter': '⌘/Ctrl+Enter',
  'settings.modelDocs': 'Docs',
  'settings.modelId': 'Model id',
  'settings.modelNotFeatured': 'Not featured',
  'settings.modelRegistryUnknown': 'Unknown',
  'settings.navAbout': 'About',
  'settings.navGeneral': 'General',
  'settings.navModel': 'Models',
  'settings.navPrompts': 'Prompts',
  'settings.navWorkers': 'Agent Worker',
  'settings.needKey': 'No key',
  'settings.perModelThinking': 'Supported thinking levels',
  'settings.perModelThinkingHint':
    'Per model: checked levels appear in the chat bar when this model is selected.',
  'settings.pickModel': 'Model',
  'settings.modelList': 'Models',
  'settings.removeModel': 'Remove model',
  'settings.firstModelHint':
    'Add at least one model to create the provider. You can add more later.',
  'settings.provider': 'Provider',
  'settings.providerBuiltin': 'Built-in',
  'settings.providerCustom': 'Custom providers',
  'settings.providerKey': '{provider} API key',
  'settings.runtime.leaderMaxSteps': 'Leader step budget',
  'settings.runtime.leaderMaxStepsDesc': 'Max steps per task, default 500',
  'settings.runtime.leaderMaxStepsError': 'Please enter an integer between 10 and 1000',
  'settings.runtime.npmRegistry': 'npm registry',
  'settings.runtime.npmRegistryDesc': 'Registry for npx package installs. Leave empty for system default.',
  'settings.runtime.npmRegistryUrl': 'Registry URL',
  'settings.runtime.npmRegistryPh': 'https://registry.npmmirror.com',
  'settings.runtime.npmRegistryErrorHttps': 'Must start with https://',
  'settings.runtime.npmRegistryErrorSpace': 'Must not contain spaces or illegal characters',
  'settings.runtime.saveSuccess': 'Runtime settings saved',
  'settings.runtime.workerTimeouts': 'Runtime',
  'settings.runtime.workerTimeoutsDesc': 'Leader step budget and Worker timeouts (minutes).',
  'settings.runtime.workerTimeoutsSave': 'Save',
  'settings.runtime.minutesUnit': 'min',
  'settings.runtime.stepsUnit': 'steps',
  'settings.runtime.workerJobTimeout': 'Worker task timeout',
  'settings.runtime.workerJobTimeoutDesc':
    'Total time after entering running state; default 10 minutes.',
  'settings.runtime.workerJobTimeoutError': 'Enter an integer from 1 to 120',
  'settings.runtime.workerApprovalTimeout': 'Approval timeout',
  'settings.runtime.workerApprovalTimeoutDesc':
    'Time to handle an ACP permission request; default 2 minutes.',
  'settings.runtime.workerApprovalTimeoutError': 'Enter an integer from 1 to 60',
  'settings.runtime.workerQueueTimeout': 'Worker queue timeout',
  'settings.runtime.workerQueueTimeoutDesc':
    'Time waiting for concurrency or ACP Session capacity; default 10 minutes.',
  'settings.runtime.workerQueueTimeoutError': 'Enter an integer from 1 to 120',
  'settings.prompts.leader': 'Leader',
  'settings.prompts.leaderHint':
    'Appended after the protected protocol and tool contract; applies from the next turn.',
  'settings.prompts.roles': 'Default role prompts',
  'settings.prompts.rolesHint':
    'Used for new session crew members and the explicit “Use role default prompt” action. Existing members are never overwritten.',
  'settings.prompts.reset': 'Restore default',
  'settings.prompts.save': 'Save',
  'settings.prompts.saved': 'Prompts saved for future crew members and the next Leader turn.',
  'settings.storageRoot': 'Config',
  'settings.storageData': 'Data',
  'settings.storageCache': 'Cache',
  'settings.save': 'Save',
  'settings.saved': 'Saved. Keys encrypted; model applies to new chats.',
  'settings.security': 'Secure storage',
  'settings.securityHint':
    'API keys are AES-256-GCM encrypted on disk (storage={storage} · {platform}). The master key is derived from the local account identity — never written to disk, never touches the OS keychain.',
  'settings.show': 'Show',
  'settings.showCustom': 'Type model id…',
  'settings.styleAnthropic': 'Anthropic',
  'settings.styleGoogle': 'Google',
  'settings.styleOpenai': 'OpenAI-compatible',
  'settings.title': 'Settings',
  'settings.updateCustom': 'Update',
  'settings.updateKey': 'Replace key',
  'settings.version': 'Version',
  'sidebar.brand': 'SwarmDesk',
  'sidebar.confirmDeleteProject':
    'Delete project “{name}” and all its sessions? This cannot be undone.',
  'sidebar.confirmDeleteSession': 'Delete session “{title}”? This cannot be undone.',
  'sidebar.deleteProject': 'Delete project',
  'sidebar.deleteSession': 'Delete session',
  'sidebar.empty': 'No projects yet. Use “Open project…” with a local path.',
  'sidebar.needProjectOpenFolder': 'Open a project first. Opening the folder picker in 3 seconds…',
  'sidebar.newTask': 'New task',
  'sidebar.noSessions': 'No sessions',
  'sidebar.now': 'now',
  'sidebar.relMinutes': '{count}m ago',
  'sidebar.relHours': '{count}h ago',
  'sidebar.relDays': '{count}d ago',
  'sidebar.relWeeks': '{count}w ago',
  'sidebar.relMonth': '1 month ago',
  'sidebar.openProject': 'Open project',
  'sidebar.projects': 'Projects',
  'sidebar.renamePlaceholder': 'Enter a new session title',
  'sidebar.renameSession': 'Rename session',
  'sidebar.settings': 'Settings',
  'sidebar.showMore': 'Show {count} more',
  'sidebar.showLess': 'Show less',
  'sidebar.statusApprove': 'Needs authorization',
  'sidebar.statusDone': 'Finished',
  'sidebar.statusError': 'Response error',
  'sidebar.statusIdle': 'Idle',
  'sidebar.statusRun': 'Running',
  'sidebar.untitledSession': 'New session',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.system': 'System',
  'workers.busy': 'Busy',
  'workers.cancel': 'Cancel',
  'workers.empty': 'No Worker is installed. Install one from Registry or register a custom ACP.',
  'workers.manualRegistration': 'Manual registration',
  'workers.manualRegistrationHint':
    'Enter a custom ACP launch method and command. Skips Registry preparation and starts the process locally.',
  'workers.registerModeAuto': 'From registry',
  'workers.registerModeManual': 'Manual',
  'workers.formArgs': 'Args (space-separated)',
  'workers.formCommand': 'Command',
  'workers.customLaunchKind': 'Custom ACP launch method',
  'workers.customSystemExecutable': 'System PATH executable',
  'workers.customLocalExecutable': 'Local absolute path',
  'workers.customPackageSpec': 'Package and version',
  'workers.formEnabled': 'Enabled',
  'workers.formName': 'Name',
  'workers.formPrimary': 'Primary role',
  'workers.formRoles': 'Secondary roles',
  'workers.formSave': 'Save',
  'workers.health.healthy': 'Ready',
  'workers.health.missing': 'Missing',
  'workers.health.unhealthy': 'Unhealthy',
  'workers.health.unknown': 'Unknown',
  'workers.authAgent': 'Start agent authentication',
  'workers.authCancel': 'Cancel authentication',
  'workers.authConfigureSecrets': 'Configure authentication variables',
  'workers.authFailed': 'Authentication failed',
  'workers.authQueued': 'Authentication queued…',
  'workers.authRunning': 'Waiting for agent authentication…',
  'workers.authSaveSecrets': 'Save and re-check',
  'workers.authSecretHint':
    'Secret values are sent only to the Owner worker-secret store and never enter snapshots, jobs, or activity.',
  'workers.authSucceeded': 'Authenticated and ready',
  'workers.defaultRole': 'Default role',
  'workers.defaultRoleInheritsModel': 'Model inherits the Worker default model',
  'workers.healthAll': 'Check all',
  'workers.healthAllHint': 'Probe all enabled workers',
  'workers.healthDeep': 'Deep check (start ACP process)',
  'workers.healthDetail': 'Health details',
  'workers.healthHint': 'Click to check whether the command is available',
  'workers.healthNoDetail': 'No details yet. Click the status badge to check.',
  'workers.model': 'Model',
  'workers.modelCatalogEmpty': 'No catalog',
  'workers.modelCatalogStale': 'Catalog stale',
  'workers.modelComboHint': 'Pick a model; choose “Load/Refresh” to fetch via ACP',
  'workers.modelDefault': 'Default (CLI)',
  'workers.modelFetch': '↻ Load models from ACP…',
  'workers.modelLoading': 'Loading from ACP…',
  'workers.modelManual': '✎ Enter model id…',
  'workers.modelNeedSelect':
    '⚠ Pick a working model. The CLI default may be disabled (“Model is disabled”) — select one from the list before dispatching.',
  'workers.modelNeedSelectOpenCode':
    '⚠ OpenCode’s default model is often disabled. Load the model list, then pick a Zen free model (e.g. Big Pickle) — do not leave “Default (CLI)”.',
  'workers.modelPlaceholder': 'model id, e.g. claude-sonnet-4…',
  'workers.modelRefresh': '↻ Refresh model list…',
  'workers.modelSearch': 'Search models…',
  'workers.primary': 'Primary',
  'workers.register': '+ Register',
  'workers.registerTitle': 'Register CLI worker',
  'workers.registered': 'Registered CLIs',
  'workers.registryAgent': 'ACP Registry agent',
  'workers.registryAgentCount': 'Agents',
  'workers.registryAuthRequired': 'Authentication required',
  'workers.registryBundledAtRelease': 'Bundled with this release',
  'workers.registryCheckUpdates': 'Check for updates',
  'workers.registryCheckingUpdates': 'Checking…',
  'workers.registryDetailAuthors': 'Authors',
  'workers.registryDetailCommand': 'Launch command projection',
  'workers.registryDetailDeclared': 'Declared SHA-256',
  'workers.registryDetailDistribution': 'Distribution',
  'workers.registryDetailIntegrity': 'Integrity',
  'workers.registryDetailLicense': 'License',
  'workers.registryDetailManifest': 'Manifest',
  'workers.registryDetailObserved': 'Observed SHA-256',
  'workers.registryDetailRepository': 'Repository',
  'workers.registryDetailRunner': 'Local prerequisite',
  'workers.registryDetailSource': 'Package / download source',
  'workers.registryDetailTitle': 'Registry agent details and trust',
  'workers.registryDetailWebsite': 'Website',
  'workers.registryDeclaredMissing': 'Not declared',
  'workers.registryDigestMatch': 'Match',
  'workers.registryDigestMismatch': 'Mismatch',
  'workers.registryEmpty': 'No matching agents',
  'workers.registryHint':
    'Search the full ACP Registry. The Owner prepares the selected agent and materializes its trusted launch command.',
  'workers.registryInstalled': 'Installed',
  'workers.registryLoading': 'Loading ACP Registry…',
  'workers.registryLocalInstall': 'local install',
  'workers.registryManifestUnavailable':
    'This Registry entry has no verifiable manifest digest and cannot be prepared by the Owner. Refresh the catalog or upgrade the app.',
  'workers.registrySelectionUnavailable':
    'The selected Registry entry is no longer available and cannot be saved as a custom Worker. Select it again or refresh the catalog.',
  'workers.registryShowingCount': '{shown} / {total}',
  'workers.registryNetworkAuthNotice':
    'Preparation may access the selected package or download source. Authentication needs are negotiated after ACP initialize.',
  'workers.registryNoShaWarning':
    'No declared SHA-256; explicit trust for the current manifest is required before preparation.',
  'workers.registryNotInstalled': 'Not installed',
  'workers.registryObservedPending': 'After preparation',
  'workers.registryPrepareCancel': 'Cancel preparation',
  'workers.registryPrepareCancelled': 'Preparation cancelled',
  'workers.registryPrepareComplete': 'Preparation complete',
  'workers.registryPrepareFailed': 'Preparation failed',
  'workers.registryPrepareQueued': 'Waiting to prepare…',
  'workers.registryPrepareRetry': 'Retry',
  'workers.registryPrepareRunning': 'Preparing agent…',
  'workers.registryRegistering': 'Registering worker…',
  'workers.registryRunnerBinary': 'Trusted binary installation directory (no system runner)',
  'workers.registryRunnerNpx': 'Requires Node.js and npx',
  'workers.registryRunnerUvx': 'Requires uv and uvx',
  'workers.registryReady': 'Ready',
  'workers.registrySandboxNotice':
    'The agent runs as a local process and is not a security sandbox. Prepare only versions and sources you trust.',
  'workers.registrySearch': 'Search agent name or ID…',
  'workers.registrySource': 'Source',
  'workers.registrySourceBundled': 'Bundled',
  'workers.registrySourcePersisted': 'Local update',
  'workers.registryTrustNoSha':
    'Trust this exact manifest and the digest observed during preparation',
  'workers.registryUnavailable': 'Unavailable here',
  'workers.registryUpdated': 'ACP Registry updated.',
  'workers.registryUpdatedAt': 'Updated',
  'workers.registryUpToDate': 'ACP Registry is up to date.',
  'workers.registryUpdateFailed':
    'Could not check for ACP Registry updates. The current catalog is still in use.',
  'workers.registryUpdateRequired': 'This Registry schema requires an application update.',
  'workers.registryOwnerManagedHint':
    'Registry agents are prepared and launched by the Owner; the command is not edited here.',
  'workers.runAuthenticate': 'Go authenticate',
  'workers.runAuthHint': '{name} ({identity}) must be authenticated before dispatch.',
  'workers.runNoOutput': 'Completed (no output)',
  'workers.runRestartContext': 'Restart this agent context',
  'workers.runTruncated': 'Output truncated',
  'workers.terminalCancel': 'Cancel and close',
  'workers.terminalClose': 'Close authentication terminal',
  'workers.terminalConnecting': 'Connecting controlled terminal…',
  'workers.terminalFailed': 'Authentication not completed',
  'workers.terminalOpen': 'Open authentication terminal',
  'workers.terminalReady': 'Terminal connected',
  'workers.terminalSucceeded': 'Authenticated and ready',
  'workers.terminalTitle': 'Agent terminal authentication',
  'workers.terminalVerifying': 'Re-checking ACP readiness…',
  'workers.roles': 'Roles',
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
