/**
 * Minimal structural type for the loose message payload the AI SDK `useChat`
 * client POSTs to /chat/:agentId. Kept local (not imported from ai-sdk) so the
 * title generator stays resilient to client-side shape drift.
 */
export interface ChatMessage {
  role?: string
  content?: string
  parts?: Array<{ type?: string; text?: string }>
}
