import * as React from 'react'
import { InfiniteCanvasView } from './canvas-view.js'
import { resolveHostFilePath } from './file-context.js'
import type { CanvasPromptPart } from './image-context.js'

interface SlotRegistryLike {
  inject(name: string, setup: () => (() => void) | void): () => void
  register(options: Record<string, unknown>, component: (props: any) => unknown): () => void
}

interface SessionPromptResultLike {
  readonly ok: boolean
  readonly error?: { readonly code?: unknown; readonly message?: unknown }
}

interface SessionFaceLike {
  prompt(content: CanvasPromptPart[], mode: 'queue' | 'steer'): Promise<SessionPromptResultLike>
}

interface SessionListLike {
  readonly byId: Readonly<Record<string, { readonly cwd?: string } | undefined>>
}

interface SessionsLike {
  readonly list: { getSnapshot(): SessionListLike }
  binding(sessionId: string): { readonly session: SessionFaceLike } | undefined
}

interface WorkspacesLike {
  openPath(path: string): Promise<void>
}

interface ClientContextLike {
  slots: SlotRegistryLike
  sessions: SessionsLike
  workspaces: WorkspacesLike
}

function promptFailureMessage(result: SessionPromptResultLike): string {
  const code = result.error?.code
  const message = result.error?.message
  const detail = [code, message].filter(value => typeof value === 'string' && value !== '').join(': ')
  return detail ? `DSH session prompt failed: ${detail}` : 'DSH session prompt failed'
}

/**
 * Canvas-only DSH client contribution.
 *
 * DSH keeps ownership of Session, conversation input, Agent Loop, tools,
 * Skills and MCP. This plugin contributes the conversation view, routes
 * selected Image Nodes through the public Session prompt face, and opens
 * produced File Nodes through the public Workspaces path opener.
 */
export function createInfiniteCanvasClientPlugin() {
  return {
    inject: ['slots', 'sessions', 'workspaces'],
    apply(ctx: ClientContextLike): void {
      const CanvasSessionView = (props: any): unknown => React.createElement(InfiniteCanvasView, {
        ...props,
        sendSessionPrompt: async (parts: CanvasPromptPart[]): Promise<void> => {
          const sessionId = String(props.sessionId ?? '')
          if (!sessionId) throw new Error('Canvas visual prompt has no DSH session id')
          const binding = ctx.sessions.binding(sessionId)
          if (!binding) throw new Error(`Canvas visual prompt cannot resolve DSH session ${sessionId}`)
          const result = await binding.session.prompt(parts, 'queue')
          if (!result.ok) throw new Error(promptFailureMessage(result))
        },
        openHostPath: async (path: string): Promise<void> => {
          const sessionId = String(props.sessionId ?? '')
          if (!sessionId) throw new Error('Canvas File Node has no DSH session id')
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          await ctx.workspaces.openPath(resolveHostFilePath(cwd, path))
        },
      })

      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'canvas',
        order: -10,
        label: 'Canvas',
      }, CanvasSessionView))
    },
  }
}
