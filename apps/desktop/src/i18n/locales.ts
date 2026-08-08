import type { WorkerRole } from '@swarmdesk-agent/shared'
import { zhTW as zhTWRaw } from './zh-TW.catalog.js'

/** UI language codes. `zh` = 简体中文, `zh-TW` = 繁體中文. */
export type Locale = 'zh' | 'zh-TW' | 'en'

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh', 'zh-TW', 'en'] as const

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'zh-TW' || value === 'en'
}

/** BCP 47 tag for Intl / HTML lang. */
export function localeToBcp47(locale: Locale): string {
  if (locale === 'zh') return 'zh-CN'
  if (locale === 'zh-TW') return 'zh-TW'
  return 'en'
}

/** True for any Chinese UI locale (simplified or traditional). */
export function isChineseLocale(locale: string): boolean {
  return locale === 'zh' || locale === 'zh-TW' || locale.startsWith('zh')
}

export type MessageKey =
  | 'permissions.autoOff'
  | 'permissions.autoOn'
  | 'permissions.defaultTitle'
  | 'permissions.defaultDescription'
  | 'permissions.autoTitle'
  | 'permissions.autoDescription'
  | 'permissions.sessionDefaultTitle'
  | 'permissions.sessionDefaultDescription'
  | 'permissions.sessionAutoTitle'
  | 'permissions.sessionAutoDescription'
  | 'permissions.draftDefaultTitle'
  | 'permissions.draftDefaultDescription'
  | 'permissions.draftAutoTitle'
  | 'permissions.draftAutoDescription'
  | 'permissions.autoResolved'
  | 'permissions.autoResolvePartial'
  | 'permissions.autoResolveFailed'
  | 'permissions.pendingCount'
  | 'permissions.failureCount'
  | 'common.cancel'
  | 'common.confirmDelete'
  | 'common.confirm'
  | 'common.retry'
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
  | 'approvals.allowOnce'
  | 'approvals.allowAlways'
  | 'approvals.rejectOnce'
  | 'approvals.rejectAlways'
  | 'approvals.agentAlwaysHint'
  | 'approvals.unknownScope'
  | 'chat.budgetExhausted'
  | 'chat.continueTask'
  | 'chat.compactDone'
  | 'chat.compactFailed'
  | 'chat.compactFreed'
  | 'chat.compactRunning'
  | 'chat.compactSkipped'
  | 'chat.ctxCompress'
  | 'chat.ctxCompressed'
  | 'chat.ctxCompressedFreed'
  | 'chat.ctxCompressFailed'
  | 'chat.ctxCompressing'
  | 'chat.ctxCacheHit'
  | 'chat.ctxNoData'
  | 'chat.ctxNothingToCompress'
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
  | 'chat.errorOpenLink'
  | 'chat.errorCopy'
  | 'chat.errorCopied'
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
  | 'chat.thinkingDone'
  | 'chat.thinkingDoneFor'
  | 'chat.worked.done'
  | 'chat.worked.for'
  | 'chat.activity.thinking'
  | 'chat.activity.composing'
  | 'chat.activity.command'
  | 'chat.activity.searching'
  | 'chat.activity.reading'
  | 'chat.activity.editing'
  | 'chat.activity.delegating'
  | 'chat.activity.updatingTodos'
  | 'chat.activity.listingWorkers'
  | 'chat.activity.listingTeam'
  | 'chat.activity.listingProjects'
  | 'chat.activity.managingTeam'
  | 'chat.activity.managingJobs'
  | 'chat.activity.managingTemplates'
  | 'chat.activity.readingContext'
  | 'chat.activity.web'
  | 'chat.activity.namingSession'
  | 'chat.taskLabel'
  | 'chat.taskProgress'
  | 'chat.process.allDone'
  | 'chat.process.label'
  | 'chat.process.live'
  | 'chat.process.miniAria'
  | 'chat.process.panelAria'
  | 'chat.process.minimize'
  | 'chat.process.minimizeAria'
  | 'chat.process.doneFold'
  | 'chat.process.doneFoldCollapse'
  | 'chat.statusRow.tasksTitle'
  | 'chat.statusRow.tasksAria'
  | 'chat.statusRow.pendingChanges.fileCountOne'
  | 'chat.statusRow.pendingChanges.fileCountMany'
  | 'chat.statusRow.pendingChanges.changedInWorkspace'
  | 'chat.statusRow.pendingChanges.title'
  | 'chat.diff.title'
  | 'chat.diff.loadFailed'
  | 'chat.diff.binary'
  | 'chat.diff.empty'
  | 'chat.diff.working'
  | 'chat.diff.staged'
  | 'chat.diff.scopeToggle'
  | 'chat.diff.viewAll'
  | 'chat.diff.openFileTitle'
  | 'chat.diff.close'
  | 'chat.diff.wrap'
  | 'chat.diff.wrapShort'
  | 'chat.diff.sideBySide'
  | 'chat.diff.sideBySideShort'
  | 'chat.diff.unified'
  | 'chat.diff.unifiedShort'
  | 'chat.diff.fullFile'
  | 'chat.diff.fullFileOff'
  | 'chat.diff.fullFileShort'
  | 'chat.diff.workingHint'
  | 'chat.diff.stagedHint'
  | 'chat.diff.scope.working'
  | 'chat.diff.scope.staged'
  | 'chat.diff.scope.turn'
  | 'chat.diff.scope.turnHint'
  | 'chat.diff.scope.turnEmpty'
  | 'chat.diff.expandAll'
  | 'chat.diff.collapseAll'
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
  | 'git.branchSwitcher.title'
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
  | 'lang.zh-TW'
  | 'prompt.browse'
  | 'prompt.cancel'
  | 'prompt.noFolder'
  | 'prompt.ok'
  | 'prompt.projectPath'
  | 'prompt.selectFolder'
  | 'layout.resizeSidebar'
  | 'layout.resizeInspector'
  | 'right.approvals'
  | 'right.jobs'
  | 'right.roles'
  | 'right.rolesHint'
  | 'memory.title'
  | 'memory.scopeHint'
  | 'memory.enabled'
  | 'memory.disabled'
  | 'memory.openEnabled'
  | 'memory.openDisabled'
  | 'memory.toggleLabel'
  | 'memory.contentLabel'
  | 'memory.contentPlaceholder'
  | 'memory.edit'
  | 'memory.save'
  | 'memory.saving'
  | 'memory.saved'
  | 'memory.loadFailed'
  | 'memory.toggleFailed'
  | 'memory.saveFailed'
  | 'memory.empty'
  | 'memory.statusLabel'
  | 'memory.lastMessages'
  | 'memory.workingMemory'
  | 'memory.semanticRecall'
  | 'memory.observationalMemory'
  | 'memory.noProject'
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
  | 'roles.confirmArchiveTitle'
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
  | 'reasoning.agentDefault'
  | 'reasoning.executionConfig'
  | 'reasoning.model'
  | 'reasoning.intensity'
  | 'reasoning.loading'
  | 'reasoning.stale'
  | 'reasoning.unsupported'
  | 'reasoning.unavailable'
  | 'reasoning.saved'
  | 'reasoning.inheritWorker'
  | 'reasoning.searchModel'
  | 'reasoning.searchIntensity'
  | 'reasoning.noMatches'
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
  | 'team.memberCount'
  | 'team.libraryEmpty'
  | 'team.libraryEmptyHint'
  | 'team.libraryManageHint'
  | 'team.libraryPageHint'
  | 'team.noMembers'
  | 'team.statCrews'
  | 'team.statMembers'
  | 'team.workerMissing'
  | 'team.workerReady'
  | 'team.workerDisabled'
  | 'team.removeMember'
  | 'team.collapseMember'
  | 'role.coder'
  | 'role.general'
  | 'role.plan'
  | 'role.research'
  | 'role.review'
  | 'role.test'
  | 'settings.aboutBody'
  | 'settings.ossTitle'
  | 'settings.ossIntro'
  | 'settings.ossCount'
  | 'settings.addProvider'
  | 'settings.deletingProvider'
  | 'settings.addFromModelsDev'
  | 'settings.addCustomGateway'
  | 'settings.modelsDevHint'
  | 'settings.modelsDevSearchPh'
  | 'settings.modelsDevSearch'
  | 'settings.modelsDevRefresh'
  | 'settings.modelsDevMeta'
  | 'settings.modelsDevFilterCount'
  | 'settings.modelsDevModelCount'
  | 'settings.modelsDevAdd'
  | 'settings.modelsDevAlreadyAdded'
  | 'settings.modelsDevEmpty'
  | 'settings.modelsDevImported'
  | 'settings.modelsDevRefreshFailed'
  | 'settings.modelsDevRefreshFailedKeepLkg'
  | 'settings.modelsDevNpmSnapshotTitle'
  | 'settings.modelsDevNpmSnapshotMessage'
  | 'settings.modelsDevNpmSnapshotConfirm'
  | 'settings.modelsDevNpmSnapshotBusy'
  | 'settings.modelsDevNpmSnapshotDone'
  | 'settings.modelsDevNpmSnapshotFailed'
  | 'settings.apiStyle'
  | 'settings.addModel'
  | 'settings.addModelBtn'
  | 'settings.addModelInline'
  | 'settings.addToList'
  | 'settings.apiRestartFailed'
  | 'settings.colorMode'
  | 'settings.colorModeDesc'
  | 'settings.lightTheme'
  | 'settings.lightThemeDesc'
  | 'settings.darkTheme'
  | 'settings.darkThemeDesc'
  | 'settings.reloadThemes'
  | 'settings.reloadThemesDesc'
  | 'settings.reloadThemesButton'
  | 'settings.reloadThemesLoading'
  | 'settings.reloadThemesSuccess'
  | 'settings.reloadThemesFailed'
  | 'appearance.system'
  | 'appearance.light'
  | 'appearance.dark'
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
  | 'settings.defaultModel'
  | 'settings.defaultModelSet'
  | 'settings.deleteProvider'
  | 'settings.deleteProviderConfirm'
  | 'settings.editCustom'
  | 'settings.setDefaultModel'
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
  | 'settings.motion'
  | 'settings.motionDesc'
  | 'settings.motionSystem'
  | 'settings.motionOn'
  | 'settings.motionOff'
  | 'settings.modelDocs'
  | 'settings.modelId'
  | 'settings.modelNotFeatured'
  | 'settings.modelRegistryUnknown'
  | 'settings.navAbout'
  | 'settings.navGeneral'
  | 'settings.navModel'
  | 'settings.navPrompts'
  | 'settings.navWorkers'
  | 'settings.navTeams'
  | 'settings.descTeams'
  | 'settings.needKey'
  | 'settings.perModelThinking'
  | 'settings.perModelThinkingHint'
  | 'settings.pickModel'
  | 'settings.firstModelHint'
  | 'settings.modelList'
  | 'settings.modelTagMultimodal'
  | 'settings.modelTagTools'
  | 'settings.removeModel'
  | 'settings.provider'
  | 'settings.providerBuiltin'
  | 'settings.providerCustom'
  | 'settings.providerDeleted'
  | 'settings.providerKey'
  | 'settings.descGeneral'
  | 'settings.descModel'
  | 'settings.descPrompts'
  | 'settings.descWorkers'
  | 'settings.descAbout'
  | 'settings.danger.title'
  | 'settings.danger.collapsedDesc'
  | 'settings.danger.warning'
  | 'settings.danger.warningTitle'
  | 'settings.danger.warningConfirm'
  | 'settings.danger.impactLabel'
  | 'settings.danger.impactSettingsBasic'
  | 'settings.danger.impactSettingsPrompts'
  | 'settings.danger.impactSettingsModelsKeys'
  | 'settings.danger.impactCache'
  | 'settings.danger.workersCount'
  | 'settings.danger.workerSessionsCount'
  | 'settings.danger.crewsCount'
  | 'settings.danger.chatSessionsCount'
  | 'settings.danger.projectsCount'
  | 'settings.danger.resetSettingsTitle'
  | 'settings.danger.resetSettingsDesc'
  | 'settings.danger.resetSettingsConfirm'
  | 'settings.danger.resetSettingsButton'
  | 'settings.danger.clearWorkersTitle'
  | 'settings.danger.clearWorkersDesc'
  | 'settings.danger.clearWorkersConfirm'
  | 'settings.danger.clearWorkersButton'
  | 'settings.danger.clearSessionsTitle'
  | 'settings.danger.clearSessionsDesc'
  | 'settings.danger.clearSessionsConfirm'
  | 'settings.danger.clearSessionsButton'
  | 'settings.danger.clearCacheTitle'
  | 'settings.danger.clearCacheDesc'
  | 'settings.danger.clearCacheConfirm'
  | 'settings.danger.clearCacheButton'
  | 'settings.danger.resetAllTitle'
  | 'settings.danger.resetAllDesc'
  | 'settings.danger.resetAllConfirm'
  | 'settings.danger.resetAllButton'
  | 'settings.danger.actionFailed'
  | 'settings.danger.actionCompleted'
  | 'settings.runtime.leaderMaxSteps'
  | 'settings.runtime.leaderMaxStepsDesc'
  | 'settings.runtime.leaderMaxStepsError'
  | 'settings.runtime.npmRegistry'
  | 'settings.runtime.npmRegistryDesc'
  | 'settings.runtime.npmRegistryUrl'
  | 'settings.runtime.npmRegistryPh'
  | 'settings.runtime.npmRegistryErrorHttps'
  | 'settings.runtime.npmRegistryErrorSpace'
  | 'settings.runtime.npmRegistryUpdated'
  | 'settings.runtime.npmPresets'
  | 'settings.runtime.npmPreset.system'
  | 'settings.runtime.npmPreset.npmjs'
  | 'settings.runtime.npmPreset.yarn'
  | 'settings.runtime.npmPreset.npmmirror'
  | 'settings.runtime.npmPreset.huawei'
  | 'settings.runtime.npmPreset.tencent'
  | 'settings.runtime.npmPresetRegion.cn'
  | 'settings.runtime.saveSuccess'
  | 'settings.runtime.workerTimeouts'
  | 'settings.runtime.workerTimeoutsDesc'
  | 'settings.runtime.workerTimeoutsSave'
  | 'settings.runtime.minutesUnit'
  | 'settings.runtime.stepsUnit'
  | 'settings.runtime.workerJobTimeout'
  | 'settings.runtime.workerJobTimeoutDesc'
  | 'settings.runtime.workerJobTimeoutError'
  | 'settings.runtime.workerQueueTimeout'
  | 'settings.runtime.workerQueueTimeoutDesc'
  | 'settings.runtime.workerQueueTimeoutError'
  | 'settings.notifications.title'
  | 'settings.notifications.enabled'
  | 'settings.notifications.mode'
  | 'settings.notifications.onCompletion'
  | 'settings.notifications.onError'
  | 'settings.notifications.onApproval'
  | 'settings.notifications.test'
  | 'settings.notifications.testBody'
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
  | 'sidebar.confirmDeleteAction'
  | 'sidebar.deleteProject'
  | 'sidebar.deleteSession'
  | 'sidebar.crews'
  | 'sidebar.crewsEmpty'
  | 'sidebar.manage'
  | 'sidebar.manageCrews'
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
  | 'workers.formCommandAutoPlaceholder'
  | 'workers.customLaunchKind'
  | 'workers.customAutoDetect'
  | 'workers.customSystemExecutable'
  | 'workers.customLocalExecutable'
  | 'workers.customPackageSpec'
  | 'workers.formEnabled'
  | 'workers.enablingProbe'
  | 'workers.enablingAuthRequired'
  | 'workers.enablingFailed'
  | 'workers.confirmTitle'
  | 'workers.confirmConnected'
  | 'workers.confirmCommand'
  | 'workers.confirmProtocol'
  | 'workers.confirmSessionCaps'
  | 'workers.confirmLogout'
  | 'workers.confirmAuthMethods'
  | 'workers.confirmStatus'
  | 'workers.confirmAdd'
  | 'workers.confirmContinue'
  | 'workers.confirmForceAdd'
  | 'workers.confirmCancel'
  | 'workers.confirmDuplicateWarning'
  | 'workers.confirmAddNew'
  | 'workers.confirmReuseExisting'
  | 'workers.confirmAuthRequired'
  | 'workers.confirmAuthRequiredHint'
  | 'workers.confirmProbeFailed'
  | 'workers.confirmProbeFailedHint'
  | 'workers.capYes'
  | 'workers.capNo'
  | 'workers.delete'
  | 'workers.deleteWorker'
  | 'workers.deleteDisabledHint'
  | 'workers.deleteConfirm'
  | 'workers.deleteConfirmReferenced'
  | 'workers.deleted'
  | 'workers.deletedWithArchived'
  | 'workers.deleteErrorOpenJobs'
  | 'workers.railAgents'
  | 'workers.railCrews'
  | 'workers.newCrewName'
  | 'workers.newCrew'
  | 'workers.selectPrompt'
  | 'workers.secretTitle'
  | 'workers.secretPlaceholder'
  | 'workers.registryUpdateChecking'
  | 'workers.registryUpdate'
  | 'workers.sectionIdentity'
  | 'workers.sectionHealth'
  | 'workers.sectionCapability'
  | 'workers.sectionAuth'
  | 'workers.sectionProbe'
  | 'workers.probeRun'
  | 'workers.probeRunning'
  | 'workers.probeLogEmpty'
  | 'workers.probeLogStart'
  | 'workers.probeLogSpawn'
  | 'workers.probeLogHandshake'
  | 'workers.probeLogProtocol'
  | 'workers.probeLogAgentInfo'
  | 'workers.probeLogCapabilities'
  | 'workers.probeLogAuthMethods'
  | 'workers.probeLogNoAuth'
  | 'workers.probeLogResult'
  | 'workers.probeLogFailed'
  | 'workers.fieldCommand'
  | 'workers.fieldSource'
  | 'workers.fieldProtocol'
  | 'workers.fieldPath'
  | 'workers.fieldVersion'
  | 'workers.healthCli'
  | 'workers.healthAcp'
  | 'workers.healthProbed'
  | 'workers.healthModels'
  | 'workers.healthReadiness'
  | 'workers.capSessionLoad'
  | 'workers.capSessionResume'
  | 'workers.capSessionList'
  | 'workers.capLogout'
  | 'workers.deleteErrorReferenced'
  | 'workers.deleteErrorGeneric'
  | 'workers.formName'
  | 'workers.formIcon'
  | 'workers.formIconHint'
  | 'workers.iconNone'
  | 'workers.iconAutoMatched'
  | 'workers.formPrimary'
  | 'workers.formRoles'
  | 'workers.formSave'
  | 'workers.install'
  | 'workers.installing'
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
  | 'workers.defaultRoleUpdated'
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
  | 'workers.modelNoAcpList'
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
  | 'workers.registryDuplicate'
  | 'workers.duplicateName'
  | 'workers.registryPrepareLogTitle'
  | 'workers.registryPrepareQueued'
  | 'workers.registryPrepareRetry'
  | 'workers.registryPrepareRunning'
  | 'workers.registryPrepareStageResolving'
  | 'workers.registryPrepareStageFetchingIcon'
  | 'workers.registryPrepareStageDownloading'
  | 'workers.registryPrepareStageInstalling'
  | 'workers.registryPrepareStageFinalizing'
  | 'workers.registryPrepareStageAuthenticating'
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
  | 'workers.runApproval'
  | 'workers.runAuthHint'
  | 'workers.runError'
  | 'workers.runRuntimeRestarted'
  | 'workers.runInput'
  | 'workers.runNoOutput'
  | 'workers.runOutput'
  | 'workers.runThought'
  | 'workers.runTools'
  | 'workers.runPlan'
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
  'common.cancel': '取消',
  'common.confirmDelete': '删除',
  'common.confirm': '确认',
  'common.retry': '重试',
  'permissions.autoOff': '权限自动接受：关',
  'permissions.autoOn': '权限自动接受：开',
  'permissions.defaultTitle': '默认权限',
  'permissions.defaultDescription': 'Agent 自行处理直通操作；其余权限请求需要人工审批',
  'permissions.autoTitle': '自动授权',
  'permissions.autoDescription': '所有权限请求自动接受',
  'permissions.sessionDefaultTitle': '当前 Session：默认权限',
  'permissions.sessionDefaultDescription':
    '仅修改当前 Session；Agent 自行处理直通操作，其发出的权限请求需要人工审批。',
  'permissions.sessionAutoTitle': '当前 Session：自动授权',
  'permissions.sessionAutoDescription':
    '仅修改当前 Session；立即放行当前待审批请求，并实时自动接受后续由 Agent 发出的 ACP 权限请求。Agent 直通操作仍由 Agent 自身策略处理。',
  'permissions.draftDefaultTitle': '本次新建 Session：默认权限',
  'permissions.draftDefaultDescription':
    '仅用于本次新建 Session；Agent 自行处理直通操作，其发出的权限请求需要人工审批。',
  'permissions.draftAutoTitle': '本次新建 Session：自动授权',
  'permissions.draftAutoDescription':
    '仅用于本次新建 Session；Agent 发出的 ACP 权限请求将立即自动通过。Agent 直通操作仍由 Agent 自身策略处理。',
  'permissions.autoResolved': '当前 Session 已自动处理 {count} 个待审批请求。',
  'permissions.autoResolvePartial':
    '当前 Session 已自动处理 {resolved} 个待审批请求；{failed} 个请求解析失败，仍有 {pending} 个待审批。',
  'permissions.autoResolveFailed':
    '当前 Session 有 {count} 个待审批请求自动处理失败，剩余 {pending} 个待审批；可重试或在审批面板中手动处理。',
  'permissions.pendingCount': '仍有 {count} 个待审批请求',
  'permissions.failureCount': '{count} 个审批解析失败，可重试',
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
  'approvals.allowOnce': '允许本次',
  'approvals.allowAlways': '始终允许',
  'approvals.rejectOnce': '拒绝',
  'approvals.rejectAlways': '始终拒绝',
  'approvals.agentAlwaysHint':
    '「始终允许」的有效期由 Agent 决定，不等同于 App Session 自动授权或永久授权；Agent 直通操作仍由 Agent 自身策略处理。',
  'approvals.unknownScope': 'Agent 未提供可验证路径',
  'chat.budgetExhausted': '已消耗 {used}/{max} 步骤预算，任务可能尚未完成。',
  'chat.continueTask': '继续',
  'chat.compactDone': '上下文已压缩',
  'chat.compactFailed': '上下文压缩失败',
  'chat.compactFreed': '释放 {freed}',
  'chat.compactRunning': '正在压缩上下文',
  'chat.compactSkipped': '上下文已是最新，无需压缩',
  'chat.ctxCompress': '压缩上下文',
  'chat.ctxCompressed': '已压缩上下文',
  'chat.ctxCompressedFreed': '已压缩上下文，释放约 {freed} tokens',
  'chat.ctxCompressFailed': '压缩失败，请稍后重试',
  'chat.ctxCompressing': '压缩中…',
  'chat.ctxCacheHit': '缓存平均命中率',
  'chat.ctxNoData': '—',
  'chat.ctxNothingToCompress': '暂无可压缩的历史',
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
  'chat.errorOpenLink': '查看详情',
  'chat.errorCopy': '复制',
  'chat.errorCopied': '已复制',
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
  'chat.team': '团队',
  'chat.defaultTeam': '默认编组',
  'chat.teamNeedsMapping': '需要先在团队面板修复映射',
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
  'chat.placeholder': '描述任务，或指定角色/Worker…（{shortcut} 发送）',
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
  'chat.think.label': '思考',
  'chat.think.low': '低',
  'chat.think.max': '最高',
  'chat.think.medium': '中',
  'chat.think.off': '关闭',
  'chat.think.xhigh': '极高',
  'chat.taskLabel': '任务',
  'chat.taskProgress': '任务进度',
  'chat.process.allDone': '全部完成',
  'chat.process.label': '进程',
  'chat.process.live': '执行中',
  'chat.process.miniAria': '进程（点击展开）',
  'chat.process.panelAria': '任务进程',
  'chat.process.minimize': '折叠',
  'chat.process.minimizeAria': '折叠为迷你',
  'chat.process.doneFold': '已完成 {count} 项',
  'chat.process.doneFoldCollapse': '收起 {count} 项已完成',
  'chat.statusRow.tasksTitle': '任务',
  'chat.statusRow.tasksAria': '任务 {completed}/{total}',
  'chat.statusRow.pendingChanges.fileCountOne': '{count} 个文件',
  'chat.statusRow.pendingChanges.fileCountMany': '{count} 个文件',
  'chat.statusRow.pendingChanges.changedInWorkspace': '工作区中有变更',
  'chat.statusRow.pendingChanges.title': '已更改文件',
  'chat.diff.title': '变更文件',
  'chat.diff.loadFailed': '无法加载 diff',
  'chat.diff.binary': '二进制文件，无法预览 diff。',
  'chat.diff.empty': '此文件暂无文本 diff（可能仅为重命名或权限变更）。',
  'chat.diff.working': '工作区',
  'chat.diff.staged': '已暂存',
  'chat.diff.workingHint': '对比工作区相对暂存区的改动（git diff）',
  'chat.diff.stagedHint': '对比已暂存相对 HEAD 的改动（git diff --cached）',
  'chat.diff.scopeToggle': '切换工作区 / 已暂存 diff',
  'chat.diff.viewAll': '查看全部变更',
  'chat.diff.openFileTitle': '查看 {path}',
  'chat.diff.close': '关闭',
  'chat.diff.wrap': '自动换行',
  'chat.diff.wrapShort': '换行',
  'chat.diff.sideBySide': '左右对照视图',
  'chat.diff.sideBySideShort': '左右',
  'chat.diff.unified': '统一视图',
  'chat.diff.unifiedShort': '统一',
  'chat.diff.fullFile': '加载完整文件上下文',
  'chat.diff.fullFileOff': '仅显示改动片段',
  'chat.diff.fullFileShort': '完整',
  'chat.diff.scope.working': '已更改',
  'chat.diff.scope.staged': '已暂存',
  'chat.diff.scope.turn': '上一轮',
  'chat.diff.scope.turnHint': '上一轮变更需要会话级 diff 快照，即将支持',
  'chat.diff.scope.turnEmpty': '暂无上一轮变更记录',
  'chat.diff.expandAll': '全部展开',
  'chat.diff.collapseAll': '全部折叠',
  'chat.thinking': '思考',
  'chat.thinkingLive': '思考中',
  'chat.thinkingDone': '已思考',
  'chat.thinkingDoneFor': '已思考 {time}',
  'chat.worked.done': '已处理',
  'chat.worked.for': '已处理 {time}',
  'chat.activity.thinking': '思考中',
  'chat.activity.composing': '撰写中',
  'chat.activity.command': '执行命令',
  'chat.activity.searching': '搜索内容',
  'chat.activity.reading': '读取文件',
  'chat.activity.editing': '编辑文件',
  'chat.activity.delegating': '委派任务',
  'chat.activity.updatingTodos': '更新任务列表',
  'chat.activity.listingWorkers': '查看 Worker',
  'chat.activity.listingTeam': '查看团队',
  'chat.activity.listingProjects': '查看项目',
  'chat.activity.managingTeam': '维护团队',
  'chat.activity.managingJobs': '查询任务',
  'chat.activity.managingTemplates': '管理编组模板',
  'chat.activity.readingContext': '读取会话上下文',
  'chat.activity.web': '访问网络',
  'chat.activity.namingSession': '生成会话标题',
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
  'git.branchSwitcher.title': '切换分支',
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
  'jobs.empty': '暂无任务。可通过团队成员派发，或由 Leader 调用 dispatch-team-member。',
  'jobs.modelDisabledHint':
    '模型不可用：请到 Workers 面板为该 Worker 选择可用模型后再重试（勿使用「默认」）。',
  'jobs.needSession': '请先打开一个 Session 再派发。',
  'jobs.retry': '重试',
  'jobs.title': 'Worker 任务',
  'lang.en': 'English',
  'lang.zh': '简体中文',
  'lang.zh-TW': '繁體中文',
  'prompt.browse': '选择文件夹…',
  'prompt.cancel': '取消',
  'prompt.noFolder': '未能读取文件夹绝对路径。请重试选择，或直接把路径粘贴到输入框。',
  'prompt.ok': '确定',
  'prompt.projectPath': '项目根目录绝对路径',
  'prompt.selectFolder': '选择此文件夹',
  'right.approvals': '审批',
  'right.jobs': 'Jobs',
  'right.roles': '团队',
  'right.rolesHint':
    '团队属于当前会话。请主动添加成员并定义角色后，Worker 才会参与协作。同一 Worker 可绑定多个成员。',
  'memory.title': '项目记忆',
  'memory.scopeHint': '同一项目的会话共享',
  'memory.enabled': '已开启',
  'memory.disabled': '已关闭',
  'memory.openEnabled': '打开项目记忆面板（当前已开启）',
  'memory.openDisabled': '打开项目记忆面板（当前已关闭）',
  'memory.toggleLabel': '切换项目记忆',
  'memory.contentLabel': 'Working memory 内容',
  'memory.contentPlaceholder': '记录希望 Leader 在项目后续对话中记住的信息…',
  'memory.edit': '编辑',
  'memory.save': '保存记忆',
  'memory.saving': '保存中…',
  'memory.saved': '项目记忆已保存。',
  'memory.loadFailed': '项目记忆读取失败，请重试。',
  'memory.toggleFailed': '项目记忆开关保存失败，请重试。',
  'memory.saveFailed': '项目记忆保存失败，请重试。',
  'memory.empty': '当前没有已保存的 working memory 内容。',
  'memory.statusLabel': '项目记忆能力状态',
  'memory.lastMessages': '最近消息数量',
  'memory.workingMemory': 'Working memory',
  'memory.semanticRecall': 'Semantic recall',
  'memory.observationalMemory': 'Observational memory',
  'memory.noProject': '当前项目',
  'roles.acpDefault': 'ACP 默认模型',
  'roles.add': '添加成员',
  'roles.archive': '归档',
  'roles.archived': '成员已归档。',
  'roles.edit': '编辑',
  'roles.empty': '当前会话的团队还没有成员。',
  'roles.inheritsWorker': '继承 Worker：{model}',
  'roles.instructions': '成员提示词',
  'roles.idle': '空闲',
  'roles.model': '模型覆盖（可选）',
  'reasoning.agentDefault': '使用 Agent 默认值',
  'reasoning.executionConfig': '执行配置',
  'reasoning.model': '默认模型',
  'reasoning.intensity': '思考 / 推理强度',
  'reasoning.loading': '正在读取 ACP 可用值…',
  'reasoning.stale': '当前显示上次成功读取的缓存值',
  'reasoning.unsupported': '此 Worker / 模型未提供推理强度配置',
  'reasoning.unavailable': '{value}（当前不可用）',
  'reasoning.saved': 'Worker 执行配置已保存',
  'reasoning.inheritWorker': '继承 Worker 默认值',
  'reasoning.searchModel': '搜索模型…',
  'reasoning.searchIntensity': '搜索推理强度…',
  'reasoning.noMatches': '无匹配项',
  'roles.modelInherit': '留空以继承 Worker 默认模型',
  'roles.name': '成员名称',
  'roles.needSession': '请先打开一个会话。',
  'roles.noWorkers': '暂无可用 Worker，请先到 Agent Worker 面板安装或注册。',
  'roles.openJobs': '{count} 个进行中任务',
  'roles.resetSession': '重置会话',
  'roles.confirmResetSession':
    '确定重置「{name}」的会话吗？该成员在 Worker 侧的上下文将被清空，且不可撤销。',
  'roles.confirmArchive': '确定归档成员「{name}」吗？归档后将从当前团队中移除。',
  'roles.confirmArchiveTitle': '归档成员',
  'roles.resetBlocked': '请先完成或取消此成员的进行中任务。',
  'roles.save': '保存',
  'roles.saved': '成员已保存。',
  'roles.sessionReset': '成员会话已重置。',
  'roles.type': '角色',
  'roles.useDefaultPrompt': '使用角色默认提示词',
  'roles.worker': '绑定 Worker',
  'roles.workerMissing': 'Worker 不可用',
  'roles.factWorker': '状态',
  'roles.factModel': '模型',
  'team.templates': '编组模板',
  'team.templatesHint':
    '模板保存成员提示词、首选 Worker、角色和模型。应用模板会整组替换当前团队。',
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
  'team.openJobsBlock': '有 {count} 个未结束任务，当前不能替换团队。',
  'team.savedToast': '编组模板已保存。',
  'team.updatedToast': '编组模板已更新。',
  'team.deletedToast': '编组模板已删除。',
  'team.replacedToast': '已替换当前团队。',
  'team.memberCount': '{count} 名成员',
  'team.libraryEmpty': '暂无编组',
  'team.libraryEmptyHint': '从会话右侧 Team 面板把当前团队保存为编组后，会出现在这里。',
  'team.libraryManageHint':
    '此处可重命名、查看成员与删除编组。新建编组请在会话 Team 中「保存为模板」；应用到会话也在 Team 面板完成。',
  'team.libraryPageHint': '管理已保存的协作编组模板。',
  'team.noMembers': '该编组没有成员。',
  'team.statCrews': '编组',
  'team.statMembers': '成员席位',
  'team.workerMissing': 'Worker 缺失',
  'team.workerReady': '可用',
  'team.workerDisabled': '已禁用',
  'team.removeMember': '移除成员',
  'team.collapseMember': '收起',
  'role.coder': '编码者',
  'role.general': '通用',
  'role.plan': '规划者',
  'role.research': '调研者',
  'role.review': '审查者',
  'role.test': '测试者',
  'settings.aboutBody':
    'SwarmDesk 是本机多智能体指挥台（ACP）。Mastra Supervisor（Leader）负责规划与委派；Claude Code、Codex、OpenCode 与 Registry Agent 在本地执行，统一在桌面应用中跟踪。支持 macOS、Windows 与 Linux。',
  'settings.ossTitle': '开源项目',
  'settings.ossIntro': '本产品直接依赖的主要开源项目（非完整传递依赖清单）。',
  'settings.ossCount': '{count} 项',
  'settings.addProvider': '添加供应商',
  'settings.addFromModelsDev': '从 models.dev 添加',
  'settings.addCustomGateway': '自定义网关',
  'settings.modelsDevHint': '从 models.dev 选用已注册供应商。',
  'settings.modelsDevSearchPh': '搜索供应商名称或 id…',
  'settings.modelsDevSearch': '搜索',
  'settings.modelsDevRefresh': '刷新目录',
  'settings.modelsDevMeta': '目录共 {count} 家 · 更新于 {at}',
  'settings.modelsDevFilterCount': '筛选 {n} 家',
  'settings.modelsDevModelCount': '{n} 个模型',
  'settings.modelsDevAdd': '添加',
  'settings.modelsDevAlreadyAdded': '已添加',
  'settings.modelsDevEmpty': '没有可添加的供应商。可尝试刷新目录或换个关键词。',
  'settings.modelsDevImported': '已添加「{name}」',
  'settings.modelsDevRefreshFailed':
    '无法从 models.dev 下载目录（{error}）。请检查网络后重试，或稍后再刷新。',
  'settings.modelsDevRefreshFailedKeepLkg':
    '在线刷新失败（{error}），已继续使用本机缓存目录。',
  'settings.modelsDevNpmSnapshotTitle': '将使用 models.dev 的 npm 包更新目录',
  'settings.modelsDevNpmSnapshotMessage':
    '暂时无法连接 models.dev，将改用 models.dev 官方 npm 包（@opencode-ai/models）尝试更新目录，大约需要 1–2 分钟。若 npm 仍然失败，请到「设置 → 运行时」配置可用的 npm 镜像后再试。',
  'settings.modelsDevNpmSnapshotConfirm': '安装并刷新',
  'settings.modelsDevNpmSnapshotBusy': '正在安装…',
  'settings.modelsDevNpmSnapshotDone': '已通过 @opencode-ai/models{version} 更新目录（{count} 家供应商）',
  'settings.modelsDevNpmSnapshotFailed': 'npm 安装或写入目录失败（{error}）。请到「设置 → 运行时」检查 npm 镜像后重试。',
  'settings.apiStyle': '接口类型',
  'settings.addModel': '添加模型',
  'settings.addModelBtn': '+ 添加',
  'settings.addModelInline': '添加新模型',
  'settings.addToList': '加入列表',
  'settings.apiRestartFailed': '设置已写入，但本地 API 未能重启；当前进程尚未应用新设置。',
  'settings.colorMode': '颜色模式',
  'settings.colorModeDesc': '系统模式跟随操作系统的浅色或深色偏好',
  'settings.lightTheme': '浅色主题',
  'settings.lightThemeDesc': 'Mono Plus、其他内置主题或用户主题',
  'settings.darkTheme': '深色主题',
  'settings.darkThemeDesc': '选择深色模式使用的颜色主题',
  'settings.reloadThemes': '重新加载主题',
  'settings.reloadThemesDesc': '从主题目录重新读取 JSON 主题文件',
  'settings.reloadThemesButton': '重新加载',
  'settings.reloadThemesLoading': '加载中…',
  'settings.reloadThemesSuccess': '已加载 {count} 个用户主题',
  'settings.reloadThemesFailed': '主题加载失败，已保留当前主题',
  'appearance.system': '跟随系统',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'settings.back': '返回工作区',
  'settings.descGeneral': '主题、语言与基础行为。',
  'settings.descModel': '管理模型供应商与 API Key，配置后可在聊天时选择使用。',
  'settings.descPrompts': '设置 Leader 和各类角色在后续任务中使用的默认提示词。',
  'settings.descWorkers': '注册与管理 CLI Worker（Claude Code / Codex / OpenCode 等）。',
  'settings.descTeams': '查看、重命名与删除已保存的协作编组；新建与应用到会话在 Chat Team 中完成。',
  'settings.descAbout': '产品信息、版本与开源致谢。',
  'settings.danger.title': '危险操作',
  'settings.danger.collapsedDesc': '清理设置、Worker、聊天会话或缓存',
  'settings.danger.warning':
    '这些操作不可恢复，会永久删除本机数据。若有运行中的 Worker 任务，请先停止；不会删除主题文件、Worker 安装文件或应用本身。',
  'settings.danger.warningTitle': '进入危险操作',
  'settings.danger.warningConfirm': '我已了解，继续',
  'settings.danger.impactLabel': '本操作影响',
  'settings.danger.impactSettingsBasic': '基础设置、外观与语言',
  'settings.danger.impactSettingsPrompts': '提示词',
  'settings.danger.impactSettingsModelsKeys': '模型设置与 API 密钥',
  'settings.danger.impactCache': '可重建的模型与运行缓存',
  'settings.danger.workersCount': '注册 Worker/Agent',
  'settings.danger.workerSessionsCount': 'Worker 会话成员',
  'settings.danger.crewsCount': '已保存编组',
  'settings.danger.chatSessionsCount': '聊天 Session',
  'settings.danger.projectsCount': '项目记录',
  'settings.danger.resetSettingsTitle': '重置全部设置',
  'settings.danger.resetSettingsDesc':
    '恢复基础设置、提示词与模型设置默认值，并删除已保存的 API 密钥。',
  'settings.danger.resetSettingsConfirm':
    '将恢复所有设置和提示词默认值，并清除本机保存的 API 密钥。聊天、Worker 与主题文件不会被删除。',
  'settings.danger.resetSettingsButton': '重置设置',
  'settings.danger.clearWorkersTitle': '清除所有 Worker 与编组',
  'settings.danger.clearWorkersDesc':
    '移除 Worker 注册、Worker 会话成员、编组模板、Worker 密钥及缓存；聊天 Session 保留。',
  'settings.danger.clearWorkersConfirm':
    '将清除注册 Worker/Agent、Worker 会话成员、编组模板、Worker 密钥和模型缓存，但保留聊天 Session 与项目记录。',
  'settings.danger.clearWorkersButton': '清除 Worker 与编组',
  'settings.danger.clearSessionsTitle': '删除所有聊天 Session',
  'settings.danger.clearSessionsDesc':
    '删除聊天 Session、Mastra 历史、ACP 上下文、关联 Worker 会话成员与任务历史；项目和 Worker 保留。',
  'settings.danger.clearSessionsConfirm':
    '将删除全部聊天 Session、Mastra 对话历史、ACP 上下文及其关联的 Worker 会话成员、审批和任务历史。项目、Worker 与编组模板保留。',
  'settings.danger.clearSessionsButton': '删除聊天 Session',
  'settings.danger.clearCacheTitle': '清除缓存',
  'settings.danger.clearCacheDesc': '删除可重建的模型与运行缓存，不影响设置或安装文件。',
  'settings.danger.clearCacheConfirm':
    '将删除可重建的模型/运行缓存；不会删除设置、聊天、Worker、主题或安装文件。',
  'settings.danger.clearCacheButton': '清除缓存',
  'settings.danger.resetAllTitle': '全部重置',
  'settings.danger.resetAllDesc':
    '清空设置、Worker、编组、聊天 Session、项目记录和缓存；本地项目目录与安装文件保留。',
  'settings.danger.resetAllConfirm':
    '这是最彻底的重置：设置、密钥、Worker/Agent、编组、聊天 Session、项目记录和缓存都会删除。不会删除主题文件、Worker 安装文件或应用本身。',
  'settings.danger.resetAllButton': '全部重置',
  'settings.danger.actionFailed': '危险区操作失败，请稍后重试。',
  'settings.danger.actionCompleted': '危险区操作已完成。',
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
  'settings.defaultModel': '默认',
  'settings.defaultModelSet': '默认模型已设置为：{model}',
  'settings.deleteProvider': '删除供应商',
  'settings.deletingProvider': '删除中',
  'settings.deleteProviderConfirm':
    '删除后将移除该供应商及其已保存的 API Key，其模型不再可用。确定删除「{name}」吗？',
  'settings.editCustom': '编辑网关',
  'settings.setDefaultModel': '设为默认',
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
  'settings.motion': '动画',
  'settings.motionDesc': '面板开合、过渡与装饰动效；关闭可减轻卡顿',
  'settings.motionSystem': '跟随系统',
  'settings.motionOn': '开启',
  'settings.motionOff': '关闭',
  'settings.modelDocs': '文档',
  'settings.modelId': '模型 id',
  'settings.modelNotFeatured': '非精选',
  'settings.modelRegistryUnknown': '未登记',
  'settings.navAbout': '关于',
  'settings.navGeneral': '常规',
  'settings.navModel': '供应商',
  'settings.navPrompts': '提示词',
  'settings.navWorkers': 'Agent Worker',
  'settings.navTeams': '编组',
  'settings.needKey': '未配置 Key',
  'settings.perModelThinking': '支持的思考强度',
  'settings.perModelThinkingHint': '仅本模型：勾选可选档位；聊天栏选中该模型时只显示已勾选档位。',
  'settings.pickModel': '模型',
  'settings.modelList': '模型列表',
  'settings.modelTagMultimodal': '多模态',
  'settings.modelTagTools': '工具',
  'settings.removeModel': '删除模型',
  'settings.firstModelHint': '至少添加一个模型才能创建服务商。保存后可在浏览态继续添加更多。',
  'settings.provider': '提供方',
  'settings.providerBuiltin': '目录供应商',
  'settings.providerCustom': '自定义网关',
  'settings.providerDeleted': '供应商已删除。',
  'settings.providerKey': '{provider} API Key',
  'settings.runtime.leaderMaxSteps': 'Leader 步数预算',
  'settings.runtime.leaderMaxStepsDesc': '单次任务可执行的最大步数，默认 500',
  'settings.runtime.leaderMaxStepsError': '请输入 10 到 1000 之间的整数',
  'settings.runtime.npmRegistry': 'npm 镜像',
  'settings.runtime.npmRegistryDesc': 'npx 拉包使用的 registry；留空用系统默认。可点预设一键切换。',
  'settings.runtime.npmRegistryUrl': 'Registry URL',
  'settings.runtime.npmRegistryPh': '留空使用系统默认',
  'settings.runtime.npmRegistryErrorHttps': '必须以 https:// 开头',
  'settings.runtime.npmRegistryErrorSpace': '不能包含空格等非法字符',
  'settings.runtime.npmRegistryUpdated': 'npm 镜像已更新。',
  'settings.runtime.npmPresets': '常用镜像',
  'settings.runtime.npmPreset.system': '系统默认',
  'settings.runtime.npmPreset.npmjs': 'npm 官方',
  'settings.runtime.npmPreset.yarn': 'Yarn',
  'settings.runtime.npmPreset.npmmirror': 'npmmirror（淘宝）',
  'settings.runtime.npmPreset.huawei': '华为云',
  'settings.runtime.npmPreset.tencent': '腾讯云',
  'settings.runtime.npmPresetRegion.cn': '国内',
  'settings.runtime.saveSuccess': '运行设置已保存',
  'settings.runtime.workerTimeouts': 'Worker执行设置',
  'settings.runtime.workerTimeoutsDesc': 'Leader 步数预算与 Worker 超时（分钟）。',
  'settings.runtime.workerTimeoutsSave': '保存',
  'settings.runtime.minutesUnit': '分钟',
  'settings.runtime.stepsUnit': '步',
  'settings.runtime.workerJobTimeout': 'Worker 任务超时',
  'settings.runtime.workerJobTimeoutDesc':
    'ACP 无回传且无审批，等到超时将终止 Worker。有回传会续期。默认 10 分钟。',
  'settings.runtime.workerJobTimeoutError': '请输入 1 到 120 之间的整数',
  'settings.runtime.workerQueueTimeout': 'Worker 排队超时',
  'settings.runtime.workerQueueTimeoutDesc': '等待并发槽或 ACP Session 容量的时间，默认 10 分钟。',
  'settings.runtime.workerQueueTimeoutError': '请输入 1 到 120 之间的整数',
  'settings.notifications.title': '通知',
  'settings.notifications.enabled': '启用系统通知',
  'settings.notifications.mode': '窗口聚焦时也显示通知',
  'settings.notifications.onCompletion': '会话完成时通知',
  'settings.notifications.onError': '会话失败时通知',
  'settings.notifications.onApproval': '需要审批时通知',
  'settings.notifications.test': '发送测试通知',
  'settings.notifications.testBody': '系统通知已就绪',
  'settings.prompts.leader': 'Leader',
  'settings.prompts.leaderHint': '此内容会附加在内置协议和工具约束之后，从下一轮对话开始生效。',
  'settings.prompts.roles': '角色默认提示词',
  'settings.prompts.rolesHint':
    '用于添加团队成员时的默认提示词，以及成员编辑器中的“使用角色默认提示词”；不会覆盖已有成员。',
  'settings.prompts.reset': '恢复默认',
  'settings.prompts.save': '保存',
  'settings.prompts.saved': '提示词已保存，将用于后续新建团队成员和下一轮 Leader 对话。',
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
  'sidebar.confirmDeleteAction': '再次点击确认删除',
  'sidebar.deleteProject': '删除项目',
  'sidebar.deleteSession': '删除 Session',
  'sidebar.crews': '编组',
  'sidebar.crewsEmpty': '暂无编组',
  'sidebar.manage': '管理',
  'sidebar.manageCrews': '管理编组',
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
  'workers.formCommandAutoPlaceholder': 'codex · claude · ~/.local/bin/agent · @scope/pkg',
  'workers.customLaunchKind': '自定义 ACP 启动方式',
  'workers.customAutoDetect': '自动检测',
  'workers.customSystemExecutable': '系统 PATH 可执行文件',
  'workers.customLocalExecutable': '本地绝对路径',
  'workers.customPackageSpec': '包名与版本',
  'workers.confirmTitle': '添加 CLI',
  'workers.confirmConnected': '已连接到 ACP agent，请确认信息：',
  'workers.confirmCommand': '命令',
  'workers.confirmProtocol': '协议版本',
  'workers.confirmSessionCaps': '会话能力',
  'workers.confirmLogout': '登出',
  'workers.confirmAuthMethods': '认证方式',
  'workers.confirmStatus': '状态',
  'workers.confirmAdd': '确认添加',
  'workers.confirmContinue': '继续',
  'workers.confirmForceAdd': '强制添加',
  'workers.confirmCancel': '取消',
  'workers.confirmDuplicateWarning': '检测到已存在相同的 CLI：',
  'workers.confirmAddNew': '添加为新的 CLI',
  'workers.confirmReuseExisting': '复用现有的',
  'workers.confirmAuthRequired': '该 CLI 需要先登录认证才能使用。',
  'workers.confirmAuthRequiredHint': '请先在终端完成该 CLI 的登录，再回来添加。',
  'workers.confirmProbeFailed': '无法连接到 ACP agent。',
  'workers.confirmProbeFailedHint': '仍可强制添加（之后可重试探测）。',
  'workers.capYes': '是',
  'workers.capNo': '否',
  'workers.delete': '删除',
  'workers.deleteWorker': '删除 Worker',
  'workers.deleteDisabledHint': '请先禁用再删除',
  'workers.railAgents': 'Agents',
  'workers.railCrews': '编组',
  'workers.newCrewName': '新编组',
  'workers.newCrew': '新建',
  'workers.selectPrompt': '从左侧选择一个 Agent 或编组',
  'workers.secretTitle': '{name} 凭证',
  'workers.secretPlaceholder': '输入密钥…',
  'workers.registryUpdateChecking': '检查更新中…',
  'workers.registryUpdate': '检查更新',
  'workers.sectionIdentity': '基本信息',
  'workers.sectionHealth': '健康状态',
  'workers.sectionCapability': '能力矩阵',
  'workers.sectionAuth': '认证方式',
  'workers.sectionProbe': 'ACP 探测',
  'workers.probeRun': '重新探测',
  'workers.probeRunning': '探测中',
  'workers.probeLogEmpty': '尚未探测。点击「重新探测」启动 ACP 握手。',
  'workers.probeLogStart': '开始探测 {name}',
  'workers.probeLogSpawn': '启动 ACP 子进程…',
  'workers.probeLogHandshake': '执行 initialize 握手…',
  'workers.probeLogProtocol': '协议版本 ACP {version}',
  'workers.probeLogAgentInfo': 'Agent：{name} v{version}',
  'workers.probeLogCapabilities': '能力：{caps}',
  'workers.probeLogAuthMethods': '认证方式：{methods}',
  'workers.probeLogNoAuth': '无需认证',
  'workers.probeLogResult': '结果：{status}（耗时 {elapsed}ms）',
  'workers.probeLogFailed': '探测失败（耗时 {elapsed}ms）',
  'workers.fieldCommand': '命令',
  'workers.fieldSource': '来源',
  'workers.fieldProtocol': '协议',
  'workers.fieldPath': '路径',
  'workers.fieldVersion': '版本',
  'workers.healthCli': 'CLI',
  'workers.healthAcp': 'ACP',
  'workers.healthProbed': '探测',
  'workers.healthModels': '模型',
  'workers.healthReadiness': '就绪',
  'workers.capSessionLoad': '会话加载',
  'workers.capSessionResume': '会话恢复',
  'workers.capSessionList': '会话列表',
  'workers.capLogout': '登出',
  'workers.deleteConfirm': '确定删除「{name}」？该操作不可撤销。',
  'workers.deleteConfirmReferenced':
    '「{name}」正被 {count} 个团队成员使用。删除后这些成员将被自动归档，相关会话需重新组队。确定删除？',
  'workers.deleted': '已删除',
  'workers.deletedWithArchived': '已删除，{count} 个团队成员已自动归档，相关会话需重新组队。',
  'workers.deleteErrorOpenJobs': '该 Worker 有进行中的任务，请先取消或完成后再删除。',
  'workers.deleteErrorReferenced': '该 Worker 正被团队会话使用，请先归档相关成员后再删除。',
  'workers.deleteErrorGeneric': '删除失败，该 Worker 可能仍在使用中，请稍后重试。',
  'workers.formEnabled': '启用',
  'workers.enablingProbe': '正在探测，通过后自动启用',
  'workers.enablingAuthRequired': '该 Agent 需要先完成认证才能启用',
  'workers.enablingFailed': '探测未通过，无法启用',
  'workers.formName': '名称',
  'workers.formIcon': '图标',
  'workers.formIconHint': '默认按名称匹配 Registry 图标，可手动更换。',
  'workers.iconNone': '默认品牌标',
  'workers.iconAutoMatched': '自动匹配',
  'workers.formPrimary': '主角色',
  'workers.formRoles': '可兼角色',
  'workers.formSave': '保存',
  'workers.install': '安装',
  'workers.installing': '安装中',
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
  'workers.defaultRoleUpdated': '角色已更新',
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
  'workers.modelNoAcpList':
    '该 Agent 未通过 ACP 声明模型列表。可保持默认，或手动输入 model id 后回车保存。',
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
  'workers.register': '注册',
  'workers.registerTitle': '注册 CLI Worker',
  'workers.registered': '已注册 CLI',
  'workers.registryAgent': 'ACP Registry Agent',
  'workers.registryAgentCount': 'Agent 数量：{count}',
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
  'workers.registryDuplicate': '该 Registry Agent 已注册，无需重复添加',
  'workers.duplicateName': '已存在同名 Worker，请更换名称',
  'workers.registryPrepareLogTitle': '准备日志',
  'workers.registryPrepareQueued': '等待准备…',
  'workers.registryPrepareRetry': '重试',
  'workers.registryPrepareRunning': '正在准备 Agent…',
  'workers.registryPrepareStageResolving': '正在解析安装计划…',
  'workers.registryPrepareStageFetchingIcon': '正在获取图标…',
  'workers.registryPrepareStageDownloading': '正在下载安装包…',
  'workers.registryPrepareStageInstalling': '正在安装依赖…',
  'workers.registryPrepareStageFinalizing': '正在写入安装记录…',
  'workers.registryPrepareStageAuthenticating': '正在认证…',
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
  'workers.runApproval': '审批',
  'workers.runAuthHint': '{name}（{identity}）需要完成认证后才能派发。',
  'workers.runError': '错误',
  'workers.runRuntimeRestarted': '运行时已重启，当前任务未完成；请手动重新运行。',
  'workers.runInput': '输入',
  'workers.runNoOutput': '已完成（无输出）',
  'workers.runOutput': '输出',
  'workers.runThought': '思考',
  'workers.runTools': '工具',
  'workers.runPlan': '计划',
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
  'common.cancel': 'Cancel',
  'common.confirmDelete': 'Delete',
  'common.confirm': 'Confirm',
  'common.retry': 'Retry',
  'permissions.autoOff': 'Auto-accept permissions: Off',
  'permissions.autoOn': 'Auto-accept permissions: On',
  'permissions.defaultTitle': 'Default permissions',
  'permissions.defaultDescription':
    'The Agent handles direct operations; permission requests require manual approval.',
  'permissions.autoTitle': 'Auto-approve',
  'permissions.autoDescription': 'All permission requests are accepted automatically.',
  'permissions.sessionDefaultTitle': 'Current Session: Default permissions',
  'permissions.sessionDefaultDescription':
    'Changes only this Session; the Agent handles direct operations and its permission requests require manual approval.',
  'permissions.sessionAutoTitle': 'Current Session: Auto-approve',
  'permissions.sessionAutoDescription':
    'Changes only this Session; immediately accepts pending ACP requests and auto-accepts future ACP requests emitted by the Agent. Direct Agent operations remain governed by the Agent.',
  'permissions.draftDefaultTitle': 'New Session draft: Default permissions',
  'permissions.draftDefaultDescription':
    'Applies only to this new Session; the Agent handles direct operations and its permission requests require manual approval.',
  'permissions.draftAutoTitle': 'New Session draft: Auto-approve',
  'permissions.draftAutoDescription':
    'Applies only to this new Session; ACP permission requests emitted by the Agent are approved immediately. Direct Agent operations remain governed by the Agent.',
  'permissions.autoResolved': 'This Session automatically handled {count} pending request(s).',
  'permissions.autoResolvePartial':
    'This Session handled {resolved} pending request(s); {failed} failed to resolve and {pending} remain pending.',
  'permissions.autoResolveFailed':
    'This Session could not automatically handle {count} pending request(s); {pending} remain pending. Retry or handle them in the approvals panel.',
  'permissions.pendingCount': '{count} pending request(s) remain',
  'permissions.failureCount': '{count} approval(s) failed to resolve; retry available',
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
  'approvals.allowOnce': 'Allow once',
  'approvals.allowAlways': 'Always allow',
  'approvals.rejectOnce': 'Reject',
  'approvals.rejectAlways': 'Always reject',
  'approvals.agentAlwaysHint':
    'How long “Always allow” lasts is decided by the Agent; it is not App Session auto-approve or a permanent grant. Direct Agent operations remain governed by the Agent.',
  'approvals.unknownScope': 'Agent did not provide a verifiable path',
  'chat.budgetExhausted': '{used}/{max} step budget exhausted. Task may be incomplete.',
  'chat.continueTask': 'Continue',
  'chat.compactDone': 'Context compressed',
  'chat.compactFailed': 'Context compression failed',
  'chat.compactFreed': 'freed {freed}',
  'chat.compactRunning': 'Compressing context',
  'chat.compactSkipped': 'Context is up to date; no compression needed',
  'chat.ctxCompress': 'Compress context',
  'chat.ctxCompressed': 'Context compressed',
  'chat.ctxCompressedFreed': 'Context compressed — freed ~{freed} tokens',
  'chat.ctxCompressFailed': 'Compression failed, please retry',
  'chat.ctxCompressing': 'Compressing…',
  'chat.ctxCacheHit': 'Avg cache hit rate',
  'chat.ctxNoData': '—',
  'chat.ctxNothingToCompress': 'Nothing to compress yet',
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
  'chat.errorOpenLink': 'View details',
  'chat.errorCopy': 'Copy',
  'chat.errorCopied': 'Copied',
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
  'chat.team': 'Team',
  'chat.defaultTeam': 'Default team',
  'chat.teamNeedsMapping': 'Fix mappings in the Team panel first',
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
  'chat.placeholder': 'Describe a task, or name a role/worker… ({shortcut} send)',
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
  'chat.think.label': 'Thinking',
  'chat.think.low': 'Low',
  'chat.think.max': 'Max',
  'chat.think.medium': 'Medium',
  'chat.think.off': 'Off',
  'chat.think.xhigh': 'Extra high',
  'chat.taskLabel': 'Task',
  'chat.taskProgress': 'Task Progress',
  'chat.process.allDone': 'All done',
  'chat.process.label': 'Tasks',
  'chat.process.live': 'Running',
  'chat.process.miniAria': 'Tasks (click to expand)',
  'chat.process.panelAria': 'Task process',
  'chat.process.minimize': 'Collapse',
  'chat.process.minimizeAria': 'Collapse to mini',
  'chat.process.doneFold': '{count} completed',
  'chat.process.doneFoldCollapse': 'Hide {count} completed',
  'chat.statusRow.tasksTitle': 'Tasks',
  'chat.statusRow.tasksAria': 'Tasks {completed}/{total}',
  'chat.statusRow.pendingChanges.fileCountOne': '{count} file',
  'chat.statusRow.pendingChanges.fileCountMany': '{count} files',
  'chat.statusRow.pendingChanges.changedInWorkspace': 'changed in workspace',
  'chat.statusRow.pendingChanges.title': 'Changed files',
  'chat.diff.title': 'Changed files',
  'chat.diff.loadFailed': 'Failed to load diff',
  'chat.diff.binary': 'Binary file — diff preview unavailable.',
  'chat.diff.empty': 'No text diff for this file (rename or mode-only change).',
  'chat.diff.working': 'Working',
  'chat.diff.staged': 'Staged',
  'chat.diff.workingHint': 'Working tree vs index (git diff)',
  'chat.diff.stagedHint': 'Staged vs HEAD (git diff --cached)',
  'chat.diff.scopeToggle': 'Toggle working / staged diff',
  'chat.diff.viewAll': 'View all changes',
  'chat.diff.openFileTitle': 'View {path}',
  'chat.diff.close': 'Close',
  'chat.diff.wrap': 'Word wrap',
  'chat.diff.wrapShort': 'Wrap',
  'chat.diff.sideBySide': 'Side-by-side view',
  'chat.diff.sideBySideShort': 'Split',
  'chat.diff.unified': 'Unified view',
  'chat.diff.unifiedShort': 'Unified',
  'chat.diff.fullFile': 'Load full file context',
  'chat.diff.fullFileOff': 'Show patch context only',
  'chat.diff.fullFileShort': 'Full',
  'chat.diff.scope.working': 'Changed',
  'chat.diff.scope.staged': 'Staged',
  'chat.diff.scope.turn': 'Last turn',
  'chat.diff.scope.turnHint': 'Last-turn diffs need a session snapshot (coming soon)',
  'chat.diff.scope.turnEmpty': 'No last-turn changes recorded',
  'chat.diff.expandAll': 'Expand all',
  'chat.diff.collapseAll': 'Collapse all',
  'chat.thinking': 'Thinking',
  'chat.thinkingLive': 'Thinking',
  'chat.thinkingDone': 'Thought',
  'chat.thinkingDoneFor': 'Thought for {time}',
  'chat.worked.done': 'Worked',
  'chat.worked.for': 'Worked for {time}',
  'chat.activity.thinking': 'thinking',
  'chat.activity.composing': 'composing',
  'chat.activity.command': 'running command',
  'chat.activity.searching': 'searching content',
  'chat.activity.reading': 'reading file',
  'chat.activity.editing': 'editing file',
  'chat.activity.delegating': 'delegating task',
  'chat.activity.updatingTodos': 'updating todos',
  'chat.activity.listingWorkers': 'listing workers',
  'chat.activity.listingTeam': 'listing team',
  'chat.activity.listingProjects': 'listing projects',
  'chat.activity.managingTeam': 'updating team',
  'chat.activity.managingJobs': 'checking jobs',
  'chat.activity.managingTemplates': 'managing templates',
  'chat.activity.readingContext': 'reading context',
  'chat.activity.web': 'searching web',
  'chat.activity.namingSession': 'naming session',
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
  'git.branchSwitcher.title': 'Switch branch',
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
    'No jobs yet. Dispatch through a team member, or let the Leader call dispatch-team-member.',
  'jobs.modelDisabledHint':
    'Model unavailable: open Workers, select a working model for this worker, then retry (do not use Default).',
  'jobs.needSession': 'Open a session before dispatching.',
  'jobs.retry': 'Retry',
  'jobs.title': 'Worker jobs',
  'lang.en': 'English',
  'lang.zh': '简体中文',
  'lang.zh-TW': '繁體中文',
  'prompt.browse': 'Browse…',
  'prompt.cancel': 'Cancel',
  'prompt.noFolder': 'No path received. Pick a folder and click Open, or paste a path.',
  'prompt.ok': 'OK',
  'prompt.projectPath': 'Absolute path to project root',
  'prompt.selectFolder': 'Select this folder',
  'right.approvals': 'Approvals',
  'right.jobs': 'Jobs',
  'right.roles': 'Team',
  'right.rolesHint':
    'The team belongs to this session. Add members and define roles before Workers join. One Worker may back multiple members.',
  'memory.title': 'Project memory',
  'memory.scopeHint': 'Shared by sessions in this project',
  'memory.enabled': 'Enabled',
  'memory.disabled': 'Disabled',
  'memory.openEnabled': 'Open project memory (currently enabled)',
  'memory.openDisabled': 'Open project memory (currently disabled)',
  'memory.toggleLabel': 'Toggle project memory',
  'memory.contentLabel': 'Working memory content',
  'memory.contentPlaceholder': 'Record information Leader should remember in later project chats…',
  'memory.edit': 'Edit',
  'memory.save': 'Save memory',
  'memory.saving': 'Saving…',
  'memory.saved': 'Project memory saved.',
  'memory.loadFailed': 'Could not load project memory. Try again.',
  'memory.toggleFailed': 'Could not save the project memory switch. Try again.',
  'memory.saveFailed': 'Could not save project memory. Try again.',
  'memory.empty': 'No working memory content is saved yet.',
  'memory.statusLabel': 'Project memory capability status',
  'memory.lastMessages': 'Recent messages',
  'memory.workingMemory': 'Working memory',
  'memory.semanticRecall': 'Semantic recall',
  'memory.observationalMemory': 'Observational memory',
  'memory.noProject': 'Current project',
  'roles.acpDefault': 'ACP default model',
  'roles.add': 'Add member',
  'roles.archive': 'Archive',
  'roles.archived': 'Member archived.',
  'roles.edit': 'Edit',
  'roles.empty': 'This session team has no members yet.',
  'roles.inheritsWorker': 'Inherits Worker: {model}',
  'roles.instructions': 'Member prompt',
  'roles.idle': 'Idle',
  'roles.model': 'Model override (optional)',
  'reasoning.agentDefault': 'Use Agent default',
  'reasoning.executionConfig': 'Execution configuration',
  'reasoning.model': 'Default model',
  'reasoning.intensity': 'Thinking / reasoning intensity',
  'reasoning.loading': 'Loading ACP values…',
  'reasoning.stale': 'Showing the last successfully cached values',
  'reasoning.unsupported': 'This Worker/model does not expose reasoning intensity',
  'reasoning.unavailable': '{value} (currently unavailable)',
  'reasoning.saved': 'Worker execution configuration saved',
  'reasoning.inheritWorker': 'Inherit Worker default',
  'reasoning.searchModel': 'Search models…',
  'reasoning.searchIntensity': 'Search reasoning intensity…',
  'reasoning.noMatches': 'No matches',
  'roles.modelInherit': 'Leave empty to inherit the Worker default model',
  'roles.name': 'Member name',
  'roles.needSession': 'Open a session first.',
  'roles.noWorkers': 'No Worker is available. Install or register one in Agent Worker settings.',
  'roles.openJobs': '{count} open jobs',
  'roles.resetSession': 'Reset session',
  'roles.confirmResetSession':
    'Reset the session for “{name}”? This clears the member’s Worker-side context and cannot be undone.',
  'roles.confirmArchive': 'Archive member “{name}”? It will be removed from the current team.',
  'roles.confirmArchiveTitle': 'Archive member',
  'roles.resetBlocked': 'Finish or cancel this member’s open jobs first.',
  'roles.save': 'Save',
  'roles.saved': 'Member saved.',
  'roles.sessionReset': 'Member session reset.',
  'roles.type': 'Role',
  'roles.useDefaultPrompt': 'Use role default prompt',
  'roles.worker': 'Worker binding',
  'roles.workerMissing': 'Worker unavailable',
  'roles.factWorker': 'Status',
  'roles.factModel': 'Model',
  'team.templates': 'Crew templates',
  'team.templatesHint':
    'Templates preserve member prompts, preferred Workers, roles, and models. Applying replaces the whole session team.',
  'team.savedTemplates': 'Saved templates',
  'team.newTemplate': 'New template',
  'team.templateName': 'Name',
  'team.templateDesc': 'Description (optional)',
  'team.saveCurrent': 'Save as template',
  'team.deleteTemplate': 'Delete',
  'team.saveMeta': 'Save info',
  'team.overwriteFromCurrent': 'Overwrite from team',
  'team.checkMappings': 'Check mappings',
  'team.replaceCurrent': 'Apply & replace',
  'team.close': 'Close',
  'team.mappingSection': 'Member mappings',
  'team.chooseWorker': 'Choose substitute Worker',
  'team.inheritModel': 'Inherit Worker default model',
  'team.modelPlaceholder': 'Leave blank to inherit Worker model',
  'team.openJobsBlock': '{count} open jobs block team replacement.',
  'team.savedToast': 'Crew template saved.',
  'team.updatedToast': 'Crew template updated.',
  'team.deletedToast': 'Crew template deleted.',
  'team.replacedToast': 'Current team replaced.',
  'team.memberCount': '{count} members',
  'team.libraryEmpty': 'No crews yet',
  'team.libraryEmptyHint':
    'Save the current session team from the right-hand Team panel to create a reusable crew.',
  'team.libraryManageHint':
    'Rename, inspect members, or delete crews here. Create crews via “Save as template” in a chat Team, and apply them from the same panel.',
  'team.libraryPageHint': 'Manage saved crew templates.',
  'team.noMembers': 'This crew has no members.',
  'team.statCrews': 'Crews',
  'team.statMembers': 'Seats',
  'team.workerMissing': 'Worker missing',
  'team.workerReady': 'Ready',
  'team.workerDisabled': 'Disabled',
  'team.removeMember': 'Remove member',
  'team.collapseMember': 'Collapse',
  'role.coder': 'Coder',
  'role.general': 'General',
  'role.plan': 'Planner',
  'role.research': 'Researcher',
  'role.review': 'Reviewer',
  'role.test': 'Tester',
  'settings.aboutBody':
    'SwarmDesk is a local multi-agent command center for ACP workers. A Mastra Supervisor (Leader) plans and delegates — Claude Code, Codex, OpenCode, and Registry agents run on your machine and are tracked in one desktop app. Available on macOS, Windows, and Linux.',
  'settings.ossTitle': 'Open source',
  'settings.ossIntro':
    'Major open-source projects this app depends on directly (not a full transitive list).',
  'settings.ossCount': '{count}',
  'settings.addProvider': 'Add provider',
  'settings.addFromModelsDev': 'Add from models.dev',
  'settings.addCustomGateway': 'Custom gateway',
  'settings.modelsDevHint': 'Pick a registered provider from models.dev.',
  'settings.modelsDevSearchPh': 'Search by name or id…',
  'settings.modelsDevSearch': 'Search',
  'settings.modelsDevRefresh': 'Refresh catalog',
  'settings.modelsDevMeta': '{count} providers · updated {at}',
  'settings.modelsDevFilterCount': '{n} shown',
  'settings.modelsDevModelCount': '{n} models',
  'settings.modelsDevAdd': 'Add',
  'settings.modelsDevAlreadyAdded': 'Added',
  'settings.modelsDevEmpty': 'No providers to add. Try refreshing the catalog or another query.',
  'settings.modelsDevImported': 'Added “{name}”',
  'settings.modelsDevRefreshFailed':
    'Could not download the models.dev catalog ({error}). Check your network and try again.',
  'settings.modelsDevRefreshFailedKeepLkg':
    'Online refresh failed ({error}); still using the local cached catalog.',
  'settings.modelsDevNpmSnapshotTitle': 'Update catalog with the models.dev npm package',
  'settings.modelsDevNpmSnapshotMessage':
    'models.dev is temporarily unreachable. We will try updating the catalog from the official models.dev npm package (@opencode-ai/models). This usually takes 1–2 minutes. If npm still fails, open Settings → Runtime and set a working npm registry mirror, then try again.',
  'settings.modelsDevNpmSnapshotConfirm': 'Install and refresh',
  'settings.modelsDevNpmSnapshotBusy': 'Installing…',
  'settings.modelsDevNpmSnapshotDone':
    'Catalog updated via @opencode-ai/models{version} ({count} providers)',
  'settings.modelsDevNpmSnapshotFailed':
    'npm install or catalog update failed ({error}). Check the npm registry under Settings → Runtime and try again.',
  'settings.apiStyle': 'API style',
  'settings.addModel': 'Add model',
  'settings.addModelBtn': '+ Add',
  'settings.addModelInline': 'Add new model',
  'settings.addToList': 'Add to list',
  'settings.apiRestartFailed':
    'Settings were written, but the local API could not restart and has not applied them yet.',
  'settings.colorMode': 'Color mode',
  'settings.colorModeDesc': 'System follows your operating system light/dark preference',
  'settings.lightTheme': 'Light theme',
  'settings.lightThemeDesc': 'Mono Plus, other built-in themes, or a user theme',
  'settings.darkTheme': 'Dark theme',
  'settings.darkThemeDesc': 'Color theme used in dark mode',
  'settings.reloadThemes': 'Reload themes',
  'settings.reloadThemesDesc': 'Read JSON themes from the theme directory again',
  'settings.reloadThemesButton': 'Reload',
  'settings.reloadThemesLoading': 'Loading…',
  'settings.reloadThemesSuccess': 'Loaded {count} user themes',
  'settings.reloadThemesFailed': 'Theme reload failed; current themes were kept',
  'appearance.system': 'System',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'settings.back': 'Back to workspace',
  'settings.descGeneral': 'Theme, language, and basic behavior.',
  'settings.descModel': 'Manage model providers and API keys for chat.',
  'settings.descPrompts': 'Set the default Leader and role prompts used for future tasks.',
  'settings.descWorkers': 'Register and manage CLI workers (Claude Code / Codex / OpenCode).',
  'settings.descTeams':
    'Browse, rename, and delete saved collaborative crews. Create and apply crews from Chat Team.',
  'settings.descAbout': 'Product info, version, and open-source credits.',
  'settings.danger.title': 'Dangerous actions',
  'settings.danger.collapsedDesc': 'Clear settings, Workers, chat sessions, or caches',
  'settings.danger.warning':
    'These actions are irreversible and permanently delete local data. Stop any running Worker jobs first. Theme files, Worker installations, and the app itself are not removed.',
  'settings.danger.warningTitle': 'Enter dangerous actions',
  'settings.danger.warningConfirm': 'I understand — continue',
  'settings.danger.impactLabel': 'This action affects',
  'settings.danger.impactSettingsBasic': 'Basic settings, appearance, and language',
  'settings.danger.impactSettingsPrompts': 'Prompts',
  'settings.danger.impactSettingsModelsKeys': 'Model settings and API keys',
  'settings.danger.impactCache': 'Rebuildable model and runtime caches',
  'settings.danger.workersCount': 'Registered Workers/Agents',
  'settings.danger.workerSessionsCount': 'Worker session members',
  'settings.danger.crewsCount': 'Saved crews',
  'settings.danger.chatSessionsCount': 'Chat Sessions',
  'settings.danger.projectsCount': 'Project records',
  'settings.danger.resetSettingsTitle': 'Reset all settings',
  'settings.danger.resetSettingsDesc':
    'Restore basic settings, prompts, and model settings, then remove saved API keys.',
  'settings.danger.resetSettingsConfirm':
    'All settings and prompts will return to defaults, and saved API keys will be removed. Chats, Workers, and theme files remain.',
  'settings.danger.resetSettingsButton': 'Reset settings',
  'settings.danger.clearWorkersTitle': 'Clear all Workers and crews',
  'settings.danger.clearWorkersDesc':
    'Remove Worker registrations, Worker session members, crew templates, Worker secrets, and caches; chat Sessions remain.',
  'settings.danger.clearWorkersConfirm':
    'Registered Workers/Agents, Worker session members, crew templates, Worker secrets, and model caches will be cleared. Chat Sessions and project records remain.',
  'settings.danger.clearWorkersButton': 'Clear Workers & crews',
  'settings.danger.clearSessionsTitle': 'Delete all chat Sessions',
  'settings.danger.clearSessionsDesc':
    'Delete chat Sessions, Mastra history, ACP contexts, linked Worker session members, and job history; projects and Workers remain.',
  'settings.danger.clearSessionsConfirm':
    'All chat Sessions, Mastra conversation history, ACP contexts, linked Worker session members, approvals, and job history will be deleted. Projects, Workers, and crew templates remain.',
  'settings.danger.clearSessionsButton': 'Delete chat Sessions',
  'settings.danger.clearCacheTitle': 'Clear cache',
  'settings.danger.clearCacheDesc':
    'Delete rebuildable model and runtime caches without touching settings or installations.',
  'settings.danger.clearCacheConfirm':
    'Rebuildable model/runtime caches will be deleted. Settings, chats, Workers, themes, and installation files remain.',
  'settings.danger.clearCacheButton': 'Clear cache',
  'settings.danger.resetAllTitle': 'Reset everything',
  'settings.danger.resetAllDesc':
    'Clear settings, Workers, crews, chat Sessions, project records, and caches; local project directories and installations remain.',
  'settings.danger.resetAllConfirm':
    'This is the most complete reset: settings, keys, Workers/Agents, crews, chat Sessions, project records, and caches will be deleted. Theme files, Worker installations, and the app itself remain.',
  'settings.danger.resetAllButton': 'Reset everything',
  'settings.danger.actionFailed': 'Danger-zone action failed. Try again later.',
  'settings.danger.actionCompleted': 'Danger-zone action completed.',
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
  'settings.defaultModel': 'Default',
  'settings.defaultModelSet': 'Default model set to: {model}',
  'settings.deleteProvider': 'Delete provider',
  'settings.deletingProvider': 'Deleting…',
  'settings.deleteProviderConfirm':
    'This removes the provider and its saved API key; its models will no longer be available. Delete "{name}"?',
  'settings.editCustom': 'Edit gateway',
  'settings.setDefaultModel': 'Set as default',
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
  'settings.motion': 'Animation',
  'settings.motionDesc': 'Panel transitions and decorative motion; turn off to reduce jank',
  'settings.motionSystem': 'System',
  'settings.motionOn': 'On',
  'settings.motionOff': 'Off',
  'settings.modelDocs': 'Docs',
  'settings.modelId': 'Model id',
  'settings.modelNotFeatured': 'Not featured',
  'settings.modelRegistryUnknown': 'Unknown',
  'settings.navAbout': 'About',
  'settings.navGeneral': 'General',
  'settings.navModel': 'Providers',
  'settings.navPrompts': 'Prompts',
  'settings.navWorkers': 'Agent Worker',
  'settings.navTeams': 'Crews',
  'settings.needKey': 'No key',
  'settings.perModelThinking': 'Supported thinking levels',
  'settings.perModelThinkingHint':
    'Per model: checked levels appear in the chat bar when this model is selected.',
  'settings.pickModel': 'Model',
  'settings.modelList': 'Models',
  'settings.modelTagMultimodal': 'Multimodal',
  'settings.modelTagTools': 'Tools',
  'settings.removeModel': 'Remove model',
  'settings.firstModelHint':
    'Add at least one model to create the provider. You can add more later.',
  'settings.provider': 'Provider',
  'settings.providerBuiltin': 'Catalog',
  'settings.providerCustom': 'Custom gateways',
  'settings.providerDeleted': 'Provider deleted.',
  'settings.providerKey': '{provider} API key',
  'settings.runtime.leaderMaxSteps': 'Leader step budget',
  'settings.runtime.leaderMaxStepsDesc': 'Max steps per task, default 500',
  'settings.runtime.leaderMaxStepsError': 'Please enter an integer between 10 and 1000',
  'settings.runtime.npmRegistry': 'npm registry',
  'settings.runtime.npmRegistryDesc':
    'Registry for npx package installs. Leave empty for system default. Use a preset to switch quickly.',
  'settings.runtime.npmRegistryUrl': 'Registry URL',
  'settings.runtime.npmRegistryPh': 'Leave empty for system default',
  'settings.runtime.npmRegistryErrorHttps': 'Must start with https://',
  'settings.runtime.npmRegistryErrorSpace': 'Must not contain spaces or illegal characters',
  'settings.runtime.npmRegistryUpdated': 'npm registry updated.',
  'settings.runtime.npmPresets': 'Presets',
  'settings.runtime.npmPreset.system': 'System default',
  'settings.runtime.npmPreset.npmjs': 'npm official',
  'settings.runtime.npmPreset.yarn': 'Yarn',
  'settings.runtime.npmPreset.npmmirror': 'npmmirror (China)',
  'settings.runtime.npmPreset.huawei': 'Huawei Cloud',
  'settings.runtime.npmPreset.tencent': 'Tencent Cloud',
  'settings.runtime.npmPresetRegion.cn': 'China',
  'settings.runtime.saveSuccess': 'Runtime settings saved',
  'settings.runtime.workerTimeouts': 'Worker execution settings',
  'settings.runtime.workerTimeoutsDesc': 'Leader step budget and Worker timeouts (minutes).',
  'settings.runtime.workerTimeoutsSave': 'Save',
  'settings.runtime.minutesUnit': 'min',
  'settings.runtime.stepsUnit': 'steps',
  'settings.runtime.workerJobTimeout': 'Worker task timeout',
  'settings.runtime.workerJobTimeoutDesc':
    'If ACP is silent and there is no pending approval, the Worker is terminated when this idle timeout elapses. Activity resets the timer. Default 10 minutes.',
  'settings.runtime.workerJobTimeoutError': 'Enter an integer from 1 to 120',
  'settings.runtime.workerQueueTimeout': 'Worker queue timeout',
  'settings.runtime.workerQueueTimeoutDesc':
    'Time waiting for concurrency or ACP Session capacity; default 10 minutes.',
  'settings.runtime.workerQueueTimeoutError': 'Enter an integer from 1 to 120',
  'settings.notifications.title': 'Notifications',
  'settings.notifications.enabled': 'Enable system notifications',
  'settings.notifications.mode': 'Show notifications while the window is focused',
  'settings.notifications.onCompletion': 'Notify on session completion',
  'settings.notifications.onError': 'Notify on session failure',
  'settings.notifications.onApproval': 'Notify when approval is needed',
  'settings.notifications.test': 'Send test notification',
  'settings.notifications.testBody': 'System notifications are ready',
  'settings.prompts.leader': 'Leader',
  'settings.prompts.leaderHint':
    'Appended after the protected protocol and tool contract; applies from the next turn.',
  'settings.prompts.roles': 'Default role prompts',
  'settings.prompts.rolesHint':
    'Used when adding team members and the explicit “Use role default prompt” action. Existing members are never overwritten.',
  'settings.prompts.reset': 'Restore default',
  'settings.prompts.save': 'Save',
  'settings.prompts.saved': 'Prompts saved for future team members and the next Leader turn.',
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
    'Delete project "{name}" and all its sessions? This cannot be undone.',
  'sidebar.confirmDeleteSession': 'Delete session "{title}"? This cannot be undone.',
  'sidebar.confirmDeleteAction': 'Click again to confirm delete',
  'sidebar.deleteProject': 'Delete project',
  'sidebar.deleteSession': 'Delete session',
  'sidebar.crews': 'Crews',
  'sidebar.crewsEmpty': 'No crews yet',
  'sidebar.manage': 'Manage',
  'sidebar.manageCrews': 'Manage crews',
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
  'workers.formCommandAutoPlaceholder': 'codex · claude · ~/.local/bin/agent · @scope/pkg',
  'workers.customLaunchKind': 'Custom ACP launch method',
  'workers.customAutoDetect': 'Auto-detect',
  'workers.customSystemExecutable': 'System PATH executable',
  'workers.customLocalExecutable': 'Local absolute path',
  'workers.customPackageSpec': 'Package and version',
  'workers.confirmTitle': 'Add CLI',
  'workers.confirmConnected': 'Connected to ACP agent. Please confirm:',
  'workers.confirmCommand': 'Command',
  'workers.confirmProtocol': 'Protocol',
  'workers.confirmSessionCaps': 'Session capabilities',
  'workers.confirmLogout': 'Logout',
  'workers.confirmAuthMethods': 'Auth methods',
  'workers.confirmStatus': 'Status',
  'workers.confirmAdd': 'Confirm add',
  'workers.confirmContinue': 'Continue',
  'workers.confirmForceAdd': 'Force add',
  'workers.confirmCancel': 'Cancel',
  'workers.confirmDuplicateWarning': 'A CLI with the same identity already exists:',
  'workers.confirmAddNew': 'Add as a new CLI',
  'workers.confirmReuseExisting': 'Reuse existing',
  'workers.confirmAuthRequired': 'This CLI requires authentication before it can be used.',
  'workers.confirmAuthRequiredHint':
    'Please log in to this CLI in your terminal first, then come back.',
  'workers.confirmProbeFailed': 'Could not connect to the ACP agent.',
  'workers.confirmProbeFailedHint': 'You can still force-add it (probe can be retried later).',
  'workers.capYes': 'yes',
  'workers.capNo': 'no',
  'workers.delete': 'Delete',
  'workers.deleteWorker': 'Delete Worker',
  'workers.deleteDisabledHint': 'Disable the worker before deleting',
  'workers.railAgents': 'Agents',
  'workers.railCrews': 'Crews',
  'workers.newCrewName': 'New Crew',
  'workers.newCrew': 'New',
  'workers.selectPrompt': 'Select an Agent or Crew from the left',
  'workers.secretTitle': '{name} credentials',
  'workers.secretPlaceholder': 'Enter secret…',
  'workers.registryUpdateChecking': 'Checking…',
  'workers.registryUpdate': 'Check for updates',
  'workers.sectionIdentity': 'Profile',
  'workers.sectionHealth': 'Health',
  'workers.sectionCapability': 'Capabilities',
  'workers.sectionAuth': 'Authentication',
  'workers.sectionProbe': 'ACP probe',
  'workers.probeRun': 'Re-probe',
  'workers.probeRunning': 'Probing',
  'workers.probeLogEmpty': 'Not probed yet. Click “Re-probe” to start the ACP handshake.',
  'workers.probeLogStart': 'Probing {name}',
  'workers.probeLogSpawn': 'Spawning ACP subprocess…',
  'workers.probeLogHandshake': 'Running initialize handshake…',
  'workers.probeLogProtocol': 'Protocol version ACP {version}',
  'workers.probeLogAgentInfo': 'Agent: {name} v{version}',
  'workers.probeLogCapabilities': 'Capabilities: {caps}',
  'workers.probeLogAuthMethods': 'Auth methods: {methods}',
  'workers.probeLogNoAuth': 'No authentication required',
  'workers.probeLogResult': 'Result: {status} ({elapsed}ms)',
  'workers.probeLogFailed': 'Probe failed ({elapsed}ms)',
  'workers.fieldCommand': 'Command',
  'workers.fieldSource': 'Source',
  'workers.fieldProtocol': 'Protocol',
  'workers.fieldPath': 'Path',
  'workers.fieldVersion': 'Version',
  'workers.healthCli': 'CLI',
  'workers.healthAcp': 'ACP',
  'workers.healthProbed': 'Probed',
  'workers.healthModels': 'Models',
  'workers.healthReadiness': 'Readiness',
  'workers.capSessionLoad': 'Session load',
  'workers.capSessionResume': 'Session resume',
  'workers.capSessionList': 'Session list',
  'workers.capLogout': 'Logout',
  'workers.deleteConfirm': 'Delete "{name}"? This cannot be undone.',
  'workers.deleteConfirmReferenced':
    '"{name}" is in use by {count} team member(s). Deleting it will auto-archive them — affected sessions will need re-teaming. Delete anyway?',
  'workers.deleted': 'Deleted',
  'workers.deletedWithArchived':
    'Deleted. {count} team member(s) auto-archived — affected sessions need re-teaming.',
  'workers.deleteErrorOpenJobs':
    'This worker has in-progress jobs. Cancel or finish them before deleting.',
  'workers.deleteErrorReferenced':
    'This worker is in use by team sessions. Archive the related members first.',
  'workers.deleteErrorGeneric':
    'Failed to delete — the worker may still be in use. Please try again later.',
  'workers.formEnabled': 'Enabled',
  'workers.enablingProbe': 'Probing; will enable once it passes',
  'workers.enablingAuthRequired': 'This agent requires authentication before it can be enabled',
  'workers.enablingFailed': 'Probe did not pass; cannot enable',
  'workers.formName': 'Name',
  'workers.formIcon': 'Icon',
  'workers.formIconHint': 'Defaults to a Registry icon matched by name; you can change it.',
  'workers.iconNone': 'Default brand mark',
  'workers.iconAutoMatched': 'auto-matched',
  'workers.formPrimary': 'Primary role',
  'workers.formRoles': 'Secondary roles',
  'workers.formSave': 'Save',
  'workers.install': 'Install',
  'workers.installing': 'Installing',
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
  'workers.defaultRoleUpdated': 'Role updated',
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
  'workers.modelNoAcpList':
    'This agent does not advertise models via ACP. Keep the default, or type a model id and press Enter.',
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
  'workers.register': 'Register',
  'workers.registerTitle': 'Register CLI worker',
  'workers.registered': 'Registered CLIs',
  'workers.registryAgent': 'ACP Registry agent',
  'workers.registryAgentCount': '{count} Agents',
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
  'workers.registryDuplicate': 'This registry agent is already registered',
  'workers.duplicateName': 'A worker with this name already exists',
  'workers.registryPrepareLogTitle': 'Preparation log',
  'workers.registryPrepareQueued': 'Waiting to prepare…',
  'workers.registryPrepareRetry': 'Retry',
  'workers.registryPrepareRunning': 'Preparing agent…',
  'workers.registryPrepareStageResolving': 'Resolving install plan…',
  'workers.registryPrepareStageFetchingIcon': 'Fetching icon…',
  'workers.registryPrepareStageDownloading': 'Downloading package…',
  'workers.registryPrepareStageInstalling': 'Installing dependencies…',
  'workers.registryPrepareStageFinalizing': 'Writing installation record…',
  'workers.registryPrepareStageAuthenticating': 'Authenticating…',
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
  'workers.runApproval': 'Approval',
  'workers.runAuthHint': '{name} ({identity}) must be authenticated before dispatch.',
  'workers.runError': 'Error',
  'workers.runRuntimeRestarted': 'The worker runtime restarted before completion; manually rerun this task.',
  'workers.runInput': 'Input',
  'workers.runNoOutput': 'Completed (no output)',
  'workers.runOutput': 'Output',
  'workers.runThought': 'Thinking',
  'workers.runTools': 'Tools',
  'workers.runPlan': 'Plan',
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

const zhTW = zhTWRaw as Dict
// Keep npm placeholder in sync after OpenCC generation (generator copies simplified zh).
zhTW['settings.runtime.npmRegistryPh'] = '留空使用系統預設'
zhTW['settings.runtime.npmRegistryUpdated'] = 'npm 鏡像已更新。'
zhTW['workers.registryPrepareLogTitle'] = '準備日誌'
zhTW['workers.registryPrepareStageResolving'] = '正在解析安裝計畫…'
zhTW['workers.registryPrepareStageFetchingIcon'] = '正在取得圖示…'
zhTW['workers.registryPrepareStageDownloading'] = '正在下載安裝包…'
zhTW['workers.registryPrepareStageInstalling'] = '正在安裝依賴…'
zhTW['workers.registryPrepareStageFinalizing'] = '正在寫入安裝記錄…'
zhTW['workers.registryPrepareStageAuthenticating'] = '正在認證…'

export const catalogs: Record<Locale, Dict> = { zh, 'zh-TW': zhTW, en }

export function roleMessageKey(role: WorkerRole): MessageKey {
  return `role.${role}` as MessageKey
}

export function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
}

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh'
  const lang = navigator.language.toLowerCase()
  if (lang === 'zh-tw' || lang === 'zh-hk' || lang === 'zh-mo' || lang.startsWith('zh-hant')) {
    return 'zh-TW'
  }
  if (lang.startsWith('zh')) return 'zh'
  return 'en'
}
