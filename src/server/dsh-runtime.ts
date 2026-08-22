import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  WorkbenchAgentLike,
  WorkbenchAgentRuntimeAdapter,
  WorkbenchAgentTaskContext,
  WorkbenchProposalInput,
} from './agent-bridge.js'
import type { ChangeSet } from '../core/types.js'
import { formatWorkbenchContext } from './agent-context.js'

const PATCH_KINDS = ['add', 'update', 'delete'] as const

/** Real DeepSeek Harness adapter. Loaded only by the Host plugin entry. */
export class DshWorkbenchAgentRuntimeAdapter implements WorkbenchAgentRuntimeAdapter {
  installProposalTool(agent: WorkbenchAgentLike, onProposal: (input: WorkbenchProposalInput) => Promise<ChangeSet>): () => void {
    const definition = defineTool({
      name: 'workbench_propose',
      description: 'Submit the final proposed filesystem changes to the Workbench for human review. This does NOT write files. Use it exactly once when the requested edit is ready for review.',
      parameters: {
        reason: { type: 'string', required: true, description: 'Short explanation of the proposed change.' },
        patches: {
          type: 'array',
          required: true,
          description: 'Complete proposed patch set. update/add require full new file content; delete omits content.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, enum: [...PATCH_KINDS] },
              path: { type: 'string', required: true, description: 'Workspace-relative path.' },
              content: { type: 'string', description: 'Full new UTF-8 file content for add/update.' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            changeSetId: { type: 'string', required: true },
            patchCount: { type: 'integer', required: true },
            status: { type: 'string', required: true, const: 'proposed' },
          },
        },
        render: (_args: unknown, value: { changeSetId: string; patchCount: number; status: 'proposed' }) => [{
          type: 'text',
          text: `Submitted ChangeSet ${value.changeSetId} with ${value.patchCount} patch(es) for review. Do not mutate the workspace directly.`,
        }],
      },
      async execute(args: WorkbenchProposalInput) {
        const change = await onProposal(args)
        return { changeSetId: change.id, patchCount: change.patches.length, status: 'proposed' as const }
      },
      presentCall: (args: WorkbenchProposalInput) => ({
        card: 'generic',
        title: 'Propose Workbench changes',
        kind: 'edit',
        rawInput: args.patches.map(patch => `${patch.kind} ${patch.path}`),
      }),
    })
    return agent.ctx.tools.register(definition)
  }

  makeContextMessage(task: WorkbenchAgentTaskContext): unknown {
    const text = formatWorkbenchContext(task)
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'dsh-workbench', form: 'notice', summary: `Workbench selection: ${task.artifact.uri}` },
    })
  }

  makeFollowupMessage(task: WorkbenchAgentTaskContext): unknown {
    return createUserMessage({
      content: [{ type: 'text', text: task.instruction }],
      source: { kind: 'user' },
    })
  }
}
