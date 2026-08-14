import { Type } from 'typebox'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  addTeamMemberTool,
  applyTeamTemplateTool,
  archiveTeamMemberTool,
  cancelJobTool,
  deleteTeamTemplateTool,
  dispatchTeamMemberTool,
  getActiveContextTool,
  getJobTool,
  listJobsTool,
  listProjectsTool,
  listTeamTemplatesTool,
  listTeamTool,
  listWorkersTool,
  resetTeamMemberSessionTool,
  saveTeamTemplateTool,
  setSessionTitleTool,
  updateTeamMemberTool,
} from '../tools/session-tools.js'
import { requestContextFromRun, type LeaderRunContext } from './tool-context.js'

type MastraToolLike = {
  id: string
  description?: string
  execute: (input: unknown, context: unknown) => Promise<unknown>
}

const MASTRA_TOOLS: MastraToolLike[] = [
  listProjectsTool,
  getActiveContextTool,
  listWorkersTool,
  listTeamTool,
  addTeamMemberTool,
  updateTeamMemberTool,
  archiveTeamMemberTool,
  resetTeamMemberSessionTool,
  listTeamTemplatesTool,
  saveTeamTemplateTool,
  applyTeamTemplateTool,
  deleteTeamTemplateTool,
  dispatchTeamMemberTool,
  getJobTool,
  listJobsTool,
  cancelJobTool,
  setSessionTitleTool,
] as unknown as MastraToolLike[]

export const PIHUO_TOOL_NAMES = MASTRA_TOOLS.map((tool) => tool.id)

export function wrapPihuoTools(run: LeaderRunContext): ToolDefinition[] {
  return MASTRA_TOOLS.map((tool) =>
    defineTool({
      name: tool.id,
      label: tool.id,
      description: tool.description || tool.id,
      parameters: Type.Object({}, { additionalProperties: true }),
      executionMode: tool.id === 'dispatch-team-member' ? 'sequential' : undefined,
      execute: async (_toolCallId, params, signal) => {
        const result = await tool.execute(params, {
          requestContext: requestContextFromRun(run),
          writer: run.writer,
          abortSignal: signal,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result ?? {}) }],
          details: result,
        }
      },
    }),
  )
}
