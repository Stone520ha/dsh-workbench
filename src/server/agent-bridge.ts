import { randomUUID } from 'node:crypto'
import { validateSelection } from '../core/selection.js'
import type { Artifact, ArtifactSelection, ChangeSet, DomSelection, FilePatch, TextRangeSelection } from '../core/types.js'
import type { InspectedElement } from '../browser/session.js'
import type { BrowserSessionRegistry } from './browser-registry.js'
import type { WorkbenchScopeRegistry } from './scope-registry.js'

/** JSON-safe request sent by the browser when the user asks the Agent to change the current text selection. */
export interface WorkbenchAgentChangeRequest {
  artifactPath: string
  selection: ArtifactSelection
  instruction: string
}

/** JSON-safe request for a selected DOM node in the Session-owned Chromium tab. */
export interface WorkbenchWebAgentChangeRequest {
  tabId: string
  selection: DomSelection
  instruction: string
}

export interface WorkbenchAgentChangeResult {
  taskId: string
  changeSet: ChangeSet
}

export interface WorkbenchAgentLike {
  readonly id?: unknown
  readonly session: { header: { cwd?: string } }
  followup(message: unknown): void
  inject(message: unknown): void
  whenIdle(): Promise<void>
  readonly ctx: {
    tools: {
      register(definition: unknown): () => void
      guard(guard: (execution: { name: string }) => string | undefined): () => void
    }
  }
}

export interface WorkbenchAgentRegistryWithRuntime {
  get(sessionId: any): WorkbenchAgentLike | undefined
}

export interface WorkbenchProposalInputPatch {
  kind: 'add' | 'update' | 'delete'
  path: string
  content?: string
}

export interface WorkbenchProposalInput {
  reason: string
  patches: WorkbenchProposalInputPatch[]
}

export interface WorkbenchWebSelectionContext {
  tabId: string
  url: string
  selector: string
  tagName: string
  id: string
  className: string
  textContent: string
  rect: InspectedElement['rect']
  styles: Record<string, string>
}

export interface WorkbenchAgentTaskContext {
  taskId: string
  sessionId: string
  instruction: string
  artifact: Artifact
  selection: ArtifactSelection
  selectedText?: string
  artifactContent?: string
  web?: WorkbenchWebSelectionContext
}

/** DSH-specific runtime adapter: owns message construction and scoped tool registration. */
export interface WorkbenchAgentRuntimeAdapter {
  installProposalTool(agent: WorkbenchAgentLike, onProposal: (input: WorkbenchProposalInput) => Promise<ChangeSet>): () => void
  makeContextMessage(task: WorkbenchAgentTaskContext): unknown
  makeFollowupMessage(task: WorkbenchAgentTaskContext): unknown
}

/** Tools that can bypass review by mutating workspace/process state directly. */
export const WORKBENCH_DENIED_MUTATION_TOOLS = new Set([
  'write',
  'edit',
  'bash',
  'str_replace_editor',
  'terminal_open',
  'terminal_send',
])

/** Monotonic DSH tool guard used for native calls and nested Code Mode dispatches. */
export function workbenchMutationGuard(execution: { name: string }): string | undefined {
  if (!WORKBENCH_DENIED_MUTATION_TOOLS.has(execution.name)) return undefined
  return `Workbench review mode: ${execution.name} cannot mutate the workspace. Use workbench_propose instead.`
}

/**
 * Drives review-first Agent tasks. Model work and workspace mutation remain
 * separate: the Agent may inspect with read/search tools, while direct mutation
 * tools are denied and the only mutation-shaped output is workbench_propose.
 */
export class WorkbenchAgentBridge {
  private readonly active = new Set<string>()

  constructor(
    private readonly agents: WorkbenchAgentRegistryWithRuntime,
    private readonly scopes: WorkbenchScopeRegistry,
    private readonly runtime: WorkbenchAgentRuntimeAdapter,
    private readonly browsers?: BrowserSessionRegistry,
  ) {}

  async requestChange(sessionId: string, request: WorkbenchAgentChangeRequest): Promise<WorkbenchAgentChangeResult> {
    const instruction = requireInstruction(request.instruction)
    const { agent, service } = this.resolveSession(sessionId)
    const opened = await service.open(request.artifactPath)
    validateSelection(request.selection, opened.artifact)
    if (request.selection.kind !== 'text-range') {
      throw codedError('SELECTION_UNSUPPORTED', `Text Agent bridge requires text-range selection, got ${request.selection.kind}`)
    }
    if (opened.content === undefined) throw codedError('ARTIFACT_NOT_TEXT', 'Selected artifact has no text content')

    const task: WorkbenchAgentTaskContext = {
      taskId: randomUUID(),
      sessionId,
      instruction,
      artifact: opened.artifact,
      selection: request.selection,
      selectedText: textForSelection(opened.content, request.selection),
      artifactContent: opened.content,
    }

    return this.runTask(agent, service, task, async () => {
      const current = await service.open(request.artifactPath)
      validateSelection(request.selection, current.artifact)
    })
  }

  async requestWebChange(sessionId: string, request: WorkbenchWebAgentChangeRequest): Promise<WorkbenchAgentChangeResult> {
    const instruction = requireInstruction(request.instruction)
    const { agent, service } = this.resolveSession(sessionId)
    const browsers = this.browsers
    if (browsers === undefined) throw codedError('BROWSER_UNAVAILABLE', 'Workbench Agent bridge has no Browser runtime')
    if (!request.tabId.trim()) throw codedError('INVALID_ARGUMENT', 'tabId must be non-empty')

    // Validate against the real page immediately before the Agent receives it.
    const selected = await browsers.validateSelection(sessionId, request.tabId, request.selection)
    const task: WorkbenchAgentTaskContext = {
      taskId: randomUUID(),
      sessionId,
      instruction,
      artifact: selected.artifact,
      selection: selected.selection,
      selectedText: selected.element.textContent,
      web: webContext(request.tabId, selected.element, selected.selection),
    }

    return this.runTask(agent, service, task, async () => {
      // The page may hot-reload while the model reasons. A stale DOM target is
      // not accepted merely because the proposed filesystem patches are valid.
      await browsers.validateSelection(sessionId, request.tabId, request.selection)
    })
  }

  private resolveSession(sessionId: string) {
    const agent = this.agents.get(sessionId as never)
    if (agent === undefined) throw codedError('SESSION_NOT_LIVE', `Session is not live: ${sessionId}`)
    const cwd = agent.session.header.cwd
    if (typeof cwd !== 'string' || cwd.trim() === '') throw codedError('SESSION_NO_CWD', 'Session has no workspace cwd')
    if (this.active.has(sessionId)) throw codedError('AGENT_TASK_ACTIVE', 'A Workbench Agent task is already active for this Session')
    return { agent, service: this.scopes.for({ sessionId, cwd }) }
  }

  private async runTask(
    agent: WorkbenchAgentLike,
    service: ReturnType<WorkbenchScopeRegistry['for']>,
    task: WorkbenchAgentTaskContext,
    revalidateSelection: () => Promise<void>,
  ): Promise<WorkbenchAgentChangeResult> {
    let proposed: ChangeSet | undefined
    let proposalFailure: unknown
    this.active.add(task.sessionId)

    const disposeTool = this.runtime.installProposalTool(agent, async input => {
      if (proposed !== undefined) throw codedError('PROPOSAL_ALREADY_SUBMITTED', 'Submit exactly one final Workbench proposal per request')
      try {
        // Re-anchor to reality at the proposal boundary, not merely at task start.
        await revalidateSelection()
        const patches = await normalizeProposalPatches(service, task, input.patches)
        proposed = service.propose(input.reason, patches, task.selection)
        proposalFailure = undefined
        return proposed
      } catch (error) {
        proposalFailure = error
        throw error
      }
    })
    const disposeGuard = agent.ctx.tools.guard(workbenchMutationGuard)

    try {
      agent.inject(this.runtime.makeContextMessage(task))
      agent.followup(this.runtime.makeFollowupMessage(task))
      await agent.whenIdle()
      if (proposed === undefined) {
        if (proposalFailure !== undefined) throw proposalFailure
        throw codedError('AGENT_NO_PROPOSAL', 'Agent finished without submitting a Workbench ChangeSet')
      }
      return { taskId: task.taskId, changeSet: proposed }
    } finally {
      disposeGuard()
      disposeTool()
      this.active.delete(task.sessionId)
    }
  }
}

function webContext(tabId: string, element: InspectedElement, selection: DomSelection): WorkbenchWebSelectionContext {
  return {
    tabId,
    url: selection.url,
    selector: selection.selector,
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    textContent: element.textContent,
    rect: { ...element.rect },
    styles: { ...element.styles },
  }
}

async function normalizeProposalPatches(
  service: ReturnType<WorkbenchScopeRegistry['for']>,
  task: WorkbenchAgentTaskContext,
  proposed: readonly WorkbenchProposalInputPatch[],
): Promise<FilePatch[]> {
  if (proposed.length === 0) throw codedError('INVALID_PROPOSAL', 'Proposal must contain at least one patch')
  const patches: FilePatch[] = []
  for (const raw of proposed) {
    const patchPath = raw.path.trim()
    if (!patchPath) throw codedError('INVALID_PROPOSAL', 'Patch path must be non-empty')
    if (raw.kind === 'add') {
      if (typeof raw.content !== 'string') throw codedError('INVALID_PROPOSAL', `Add patch requires content: ${patchPath}`)
      await service.workspace.policy.resolveForWrite(patchPath)
      patches.push({ kind: 'add', path: patchPath, content: raw.content })
      continue
    }

    const opened = await service.open(patchPath)
    // A text selection pins its own file to the human-observed version. A web
    // selection pins DOM separately; source-file patches pin each current file.
    const pinsSelectedFile = task.selection.kind === 'text-range' && patchPath === task.artifact.uri
    const baseVersion = pinsSelectedFile ? task.selection.version : opened.artifact.version
    if (pinsSelectedFile && opened.artifact.version !== task.selection.version) {
      throw codedError('VERSION_CONFLICT', `Version conflict for ${patchPath}: selected ${task.selection.version}, current ${opened.artifact.version}`)
    }
    if (raw.kind === 'delete') {
      patches.push({ kind: 'delete', path: patchPath, baseVersion })
    } else {
      if (typeof raw.content !== 'string') throw codedError('INVALID_PROPOSAL', `Update patch requires content: ${patchPath}`)
      patches.push({ kind: 'update', path: patchPath, baseVersion, content: raw.content })
    }
  }
  return patches
}

export function textForSelection(content: string, selection: TextRangeSelection): string {
  const start = positionToOffset(content, selection.start.line, selection.start.column)
  const end = positionToOffset(content, selection.end.line, selection.end.column)
  return content.slice(start, end)
}

function positionToOffset(content: string, line: number, column: number): number {
  const lines = content.split('\n')
  if (line < 1 || line > lines.length) throw codedError('SELECTION_OUT_OF_RANGE', `Line ${line} is outside the artifact`)
  const lineText = lines[line - 1] ?? ''
  if (column < 1 || column > lineText.length + 1) throw codedError('SELECTION_OUT_OF_RANGE', `Column ${column} is outside line ${line}`)
  let offset = 0
  for (let i = 0; i < line - 1; i++) offset += (lines[i]?.length ?? 0) + 1
  return offset + column - 1
}

function requireInstruction(value: string): string {
  const instruction = value.trim()
  if (!instruction) throw codedError('INVALID_ARGUMENT', 'instruction must be non-empty')
  return instruction
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
