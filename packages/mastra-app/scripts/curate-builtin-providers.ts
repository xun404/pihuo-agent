/**
 * Curation logic moved to @swarmdesk-agent/core (builtin-catalog.ts) so the
 * runtime resolver (resolveBuiltinProviders) shares the exact same pipeline.
 * This module is kept as a re-export shim for sync:model-registry and tests.
 */
export {
  buildBuiltinCatalog,
  curateProvider,
  pickRecommended,
  pickDefaultLeader,
  compareVersionDesc,
  versionKey,
  filterAndSortModels,
  loadBuiltinProvidersPolicy,
  type ModelTag,
  type CuratedModel,
  type RegistryModelInfo,
  type CuratedProvider,
  type BuiltinProvidersCatalog,
  type ProviderPolicy,
  type BuiltinProvidersPolicy,
} from '@swarmdesk-agent/core'
