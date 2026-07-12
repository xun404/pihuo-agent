/**
 * Leader model catalog for Mastra router (`provider/model`).
 * Curated from models.dev + Mastra model router popular providers.
 * @see https://mastra.ai/models/providers/
 * @see https://models.dev/
 * @see https://ai-sdk.dev/
 */

export interface ModelOption {
  id: string
  label: string
  /** Short tag for UI chips */
  tag?: 'flagship' | 'fast' | 'coding' | 'cheap' | 'reasoning'
  /** Approximate context window (tokens) for UI hints */
  contextWindow?: number
}

export interface ModelProviderDef {
  id: string
  name: string
  /** Env var Mastra / AI SDK typically reads */
  apiKeyEnv: string
  /** Optional alternate env names */
  apiKeyEnvAliases?: string[]
  docsUrl: string
  /** Default API style for OpenCode-like custom gateways */
  apiStyle?: 'openai' | 'anthropic' | 'google' | 'custom'
  /** Optional default base URL (OpenAI-compatible gateways) */
  baseURL?: string
  models: ModelOption[]
}

export const MASTRA_PROVIDERS: ModelProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnv: 'OPENAI_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/openai',
    apiStyle: 'openai',
    models: [
      { id: 'openai/gpt-5.5', label: 'GPT-5.5', tag: 'flagship', contextWindow: 400000 },
      { id: 'openai/gpt-5.5-pro', label: 'GPT-5.5 Pro', tag: 'flagship', contextWindow: 400000 },
      { id: 'openai/gpt-5.4', label: 'GPT-5.4', tag: 'flagship', contextWindow: 400000 },
      { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', tag: 'fast', contextWindow: 400000 },
      { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 nano', tag: 'cheap', contextWindow: 400000 },
      { id: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex', tag: 'coding', contextWindow: 400000 },
      { id: 'openai/gpt-5.2', label: 'GPT-5.2', contextWindow: 400000 },
      { id: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex', tag: 'coding', contextWindow: 400000 },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini', tag: 'fast', contextWindow: 400000 },
      { id: 'openai/o3-mini', label: 'o3-mini', tag: 'reasoning', contextWindow: 200000 },
      { id: 'openai/gpt-4.1', label: 'GPT-4.1', contextWindow: 1047576 },
      { id: 'openai/gpt-4o', label: 'GPT-4o', contextWindow: 128000 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/anthropic',
    apiStyle: 'anthropic',
    models: [
      { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8', tag: 'flagship', contextWindow: 200000 },
      { id: 'anthropic/claude-opus-4-7', label: 'Claude Opus 4.7', tag: 'flagship', contextWindow: 200000 },
      { id: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6', tag: 'coding', contextWindow: 200000 },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', tag: 'flagship', contextWindow: 200000 },
      { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tag: 'coding', contextWindow: 200000 },
      { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5', contextWindow: 200000 },
      { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', tag: 'fast', contextWindow: 200000 },
      { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5', contextWindow: 200000 },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    apiKeyEnvAliases: ['GOOGLE_API_KEY'],
    docsUrl: 'https://mastra.ai/models/providers/google',
    apiStyle: 'google',
    models: [
      { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', tag: 'flagship', contextWindow: 1048576 },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', tag: 'fast', contextWindow: 1048576 },
      { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', tag: 'cheap', contextWindow: 1048576 },
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash', contextWindow: 1048576 },
      { id: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro', contextWindow: 1048576 },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextWindow: 1048576 },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', tag: 'fast', contextWindow: 1048576 },
      { id: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash', contextWindow: 1048576 },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    apiKeyEnv: 'XAI_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/xai',
    apiStyle: 'openai',
    models: [
      { id: 'xai/grok-4.5', label: 'Grok 4.5', tag: 'flagship', contextWindow: 256000 },
      { id: 'xai/grok-4.3', label: 'Grok 4.3', tag: 'flagship', contextWindow: 256000 },
      { id: 'xai/grok-build-0.1', label: 'Grok Build 0.1', tag: 'coding', contextWindow: 256000 },
      { id: 'xai/grok-4.20-0309-reasoning', label: 'Grok 4.20 Reasoning', tag: 'reasoning', contextWindow: 256000 },
      { id: 'xai/grok-3', label: 'Grok 3', contextWindow: 131072 },
      { id: 'xai/grok-3-mini', label: 'Grok 3 Mini', tag: 'fast', contextWindow: 131072 },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/deepseek',
    apiStyle: 'openai',
    models: [
      { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', tag: 'flagship', contextWindow: 128000 },
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', tag: 'fast', contextWindow: 128000 },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', contextWindow: 64000 },
      { id: 'deepseek/deepseek-reasoner', label: 'DeepSeek Reasoner', tag: 'reasoning', contextWindow: 64000 },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    apiKeyEnv: 'MISTRAL_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/mistral',
    apiStyle: 'openai',
    models: [
      { id: 'mistral/mistral-large-latest', label: 'Mistral Large', tag: 'flagship', contextWindow: 128000 },
      { id: 'mistral/mistral-medium-latest', label: 'Mistral Medium', contextWindow: 128000 },
      { id: 'mistral/devstral-medium-latest', label: 'Devstral 2', tag: 'coding', contextWindow: 128000 },
      { id: 'mistral/mistral-small-latest', label: 'Mistral Small', tag: 'cheap', contextWindow: 128000 },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    apiKeyEnv: 'GROQ_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/groq',
    apiStyle: 'openai',
    models: [
      { id: 'groq/llama-3.3-70b-versatile', label: 'Llama 3.3 70B', tag: 'fast', contextWindow: 128000 },
      { id: 'groq/llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', tag: 'cheap', contextWindow: 128000 },
      { id: 'groq/qwen-qwq-32b', label: 'QwQ 32B', tag: 'reasoning', contextWindow: 128000 },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    docsUrl: 'https://openrouter.ai/models',
    apiStyle: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openrouter/openai/gpt-5.5', label: 'OR · GPT-5.5', tag: 'flagship' },
      { id: 'openrouter/anthropic/claude-sonnet-4.6', label: 'OR · Claude Sonnet 4.6', tag: 'coding' },
      { id: 'openrouter/google/gemini-2.5-flash', label: 'OR · Gemini 2.5 Flash', tag: 'fast' },
      { id: 'openrouter/deepseek/deepseek-chat', label: 'OR · DeepSeek Chat', tag: 'cheap' },
    ],
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    apiKeyEnvAliases: ['AZURE_API_KEY'],
    docsUrl: 'https://mastra.ai/models/providers/azure',
    apiStyle: 'openai',
    models: [
      { id: 'azure/gpt-5.5', label: 'Azure GPT-5.5', tag: 'flagship', contextWindow: 400000 },
      { id: 'azure/gpt-4.1', label: 'Azure GPT-4.1', contextWindow: 1047576 },
      { id: 'azure/gpt-4o', label: 'Azure GPT-4o', contextWindow: 128000 },
    ],
  },
  {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    apiKeyEnv: 'AWS_ACCESS_KEY_ID',
    apiKeyEnvAliases: ['BEDROCK_API_KEY'],
    docsUrl: 'https://mastra.ai/models/providers/amazon-bedrock',
    apiStyle: 'custom',
    models: [
      { id: 'amazon-bedrock/anthropic.claude-sonnet-4-6', label: 'Bedrock Claude Sonnet 4.6', tag: 'coding' },
      { id: 'amazon-bedrock/anthropic.claude-haiku-4-5', label: 'Bedrock Claude Haiku 4.5', tag: 'fast' },
      { id: 'amazon-bedrock/amazon.nova-pro-v1:0', label: 'Amazon Nova Pro', tag: 'flagship' },
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    apiKeyEnv: 'COHERE_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/cohere',
    apiStyle: 'openai',
    models: [
      { id: 'cohere/command-a-03-2025', label: 'Command A', tag: 'flagship', contextWindow: 256000 },
      { id: 'cohere/command-r-plus', label: 'Command R+', contextWindow: 128000 },
      { id: 'cohere/command-r', label: 'Command R', tag: 'fast', contextWindow: 128000 },
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/cerebras',
    apiStyle: 'openai',
    models: [
      { id: 'cerebras/llama-3.3-70b', label: 'Llama 3.3 70B', tag: 'fast', contextWindow: 128000 },
      { id: 'cerebras/qwen-3-32b', label: 'Qwen 3 32B', tag: 'coding', contextWindow: 128000 },
    ],
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/fireworks',
    apiStyle: 'openai',
    models: [
      { id: 'fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3 70B', tag: 'fast' },
      { id: 'fireworks/accounts/fireworks/models/deepseek-v3', label: 'DeepSeek V3', tag: 'flagship' },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    apiKeyEnv: 'TOGETHER_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/together',
    apiStyle: 'openai',
    models: [
      { id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo', tag: 'fast' },
      { id: 'together/deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', tag: 'reasoning' },
      { id: 'together/Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen2.5 Coder 32B', tag: 'coding' },
    ],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/perplexity',
    apiStyle: 'openai',
    models: [
      { id: 'perplexity/sonar-pro', label: 'Sonar Pro', tag: 'flagship', contextWindow: 200000 },
      { id: 'perplexity/sonar', label: 'Sonar', tag: 'fast', contextWindow: 127000 },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    apiKeyEnv: 'OLLAMA_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/ollama',
    apiStyle: 'openai',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: [
      { id: 'ollama/llama3.3', label: 'Llama 3.3', tag: 'flagship', contextWindow: 128000 },
      { id: 'ollama/qwen2.5-coder', label: 'Qwen2.5 Coder', tag: 'coding', contextWindow: 128000 },
      { id: 'ollama/deepseek-r1', label: 'DeepSeek R1', tag: 'reasoning', contextWindow: 128000 },
    ],
  },
  {
    id: 'alibaba',
    name: 'Alibaba (DashScope)',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    apiKeyEnvAliases: ['ALIBABA_API_KEY'],
    docsUrl: 'https://mastra.ai/models/providers/alibaba',
    apiStyle: 'openai',
    models: [
      { id: 'alibaba/qwen-max', label: 'Qwen Max', tag: 'flagship', contextWindow: 32768 },
      { id: 'alibaba/qwen-plus', label: 'Qwen Plus', tag: 'fast', contextWindow: 131072 },
      { id: 'alibaba/qwen-coder-plus', label: 'Qwen Coder Plus', tag: 'coding', contextWindow: 131072 },
      { id: 'alibaba/qwen-turbo', label: 'Qwen Turbo', tag: 'cheap', contextWindow: 131072 },
    ],
  },
  {
    id: 'moonshotai',
    name: 'Moonshot (Kimi)',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    apiKeyEnvAliases: ['MOONSHOTAI_API_KEY'],
    docsUrl: 'https://mastra.ai/models/providers/moonshotai',
    apiStyle: 'openai',
    models: [
      { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', tag: 'flagship', contextWindow: 256000 },
      { id: 'moonshotai/kimi-k2', label: 'Kimi K2', contextWindow: 256000 },
      { id: 'moonshotai/moonshot-v1-128k', label: 'Moonshot v1 128k', tag: 'fast', contextWindow: 128000 },
    ],
  },
  {
    id: 'zhipuai',
    name: 'Zhipu AI (GLM)',
    apiKeyEnv: 'ZHIPU_API_KEY',
    apiKeyEnvAliases: ['ZHIPUAI_API_KEY', 'GLM_API_KEY'],
    docsUrl: 'https://mastra.ai/models/providers/zhipuai',
    apiStyle: 'openai',
    models: [
      { id: 'zhipuai/glm-4.7', label: 'GLM-4.7', tag: 'flagship', contextWindow: 128000 },
      { id: 'zhipuai/glm-4.6', label: 'GLM-4.6', tag: 'coding', contextWindow: 128000 },
      { id: 'zhipuai/glm-4-flash', label: 'GLM-4 Flash', tag: 'fast', contextWindow: 128000 },
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/siliconflow',
    apiStyle: 'openai',
    baseURL: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'siliconflow/deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3', tag: 'flagship' },
      { id: 'siliconflow/Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen2.5 Coder 32B', tag: 'coding' },
      { id: 'siliconflow/Pro/deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', tag: 'reasoning' },
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    apiKeyEnv: 'NVIDIA_API_KEY',
    docsUrl: 'https://mastra.ai/models/providers/nvidia',
    apiStyle: 'openai',
    models: [
      { id: 'nvidia/meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', tag: 'fast' },
      { id: 'nvidia/deepseek-ai/deepseek-r1', label: 'DeepSeek R1', tag: 'reasoning' },
    ],
  },
  {
    id: 'cloudflare-workers-ai',
    name: 'Cloudflare Workers AI',
    apiKeyEnv: 'CLOUDFLARE_API_TOKEN',
    apiKeyEnvAliases: ['CF_API_TOKEN'],
    docsUrl: 'https://mastra.ai/models/providers/cloudflare-workers-ai',
    apiStyle: 'openai',
    models: [
      { id: 'cloudflare-workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', tag: 'fast' },
      { id: 'cloudflare-workers-ai/@cf/qwen/qwen2.5-coder-32b-instruct', label: 'Qwen2.5 Coder', tag: 'coding' },
    ],
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    apiKeyEnv: 'HUGGINGFACE_API_KEY',
    apiKeyEnvAliases: ['HF_TOKEN'],
    docsUrl: 'https://mastra.ai/models/providers/huggingface',
    apiStyle: 'openai',
    models: [
      { id: 'huggingface/meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', tag: 'flagship' },
      { id: 'huggingface/Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen2.5 Coder 32B', tag: 'coding' },
    ],
  },
]

/** All secret env keys managed by settings */
export const SECRET_ENV_KEYS = [
  ...new Set([
    ...MASTRA_PROVIDERS.map((p) => p.apiKeyEnv),
    ...MASTRA_PROVIDERS.flatMap((p) => p.apiKeyEnvAliases ?? []),
  ]),
] as string[]

export const DEFAULT_LEADER_MODEL = 'openai/gpt-5.5'

/** Quick-pick recommendations for empty state */
export const RECOMMENDED_MODELS: { id: string; label: string; reason: string }[] = [
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', reason: 'balanced' },
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', reason: 'coding' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', reason: 'fast' },
  { id: 'xai/grok-4.5', label: 'Grok 4.5', reason: 'flagship' },
  { id: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex', reason: 'coding' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', reason: 'cheap' },
  { id: 'alibaba/qwen-coder-plus', label: 'Qwen Coder Plus', reason: 'coding' },
  { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', reason: 'flagship' },
]

export function findProviderForModel(modelId: string): ModelProviderDef | undefined {
  const prefix = modelId.split('/')[0]
  return (
    MASTRA_PROVIDERS.find((p) => p.models.some((m) => m.id === modelId)) ??
    MASTRA_PROVIDERS.find((p) => p.id === prefix)
  )
}

export function findProviderByEnvKey(envKey: string): ModelProviderDef | undefined {
  return MASTRA_PROVIDERS.find(
    (p) => p.apiKeyEnv === envKey || p.apiKeyEnvAliases?.includes(envKey),
  )
}

/** Normalize api style for custom / OpenCode-like gateways */
export type ApiStyle = 'openai' | 'anthropic' | 'google' | 'custom'

export function normalizeApiStyle(raw: string | undefined | null): ApiStyle {
  const v = (raw ?? 'openai').toLowerCase().trim()
  if (v === 'anthropic' || v === 'claude') return 'anthropic'
  if (v === 'google' || v === 'gemini') return 'google'
  if (v === 'custom') return 'custom'
  return 'openai'
}
