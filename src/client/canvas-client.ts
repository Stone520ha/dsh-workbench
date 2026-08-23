import * as React from 'react'
import { InfiniteCanvasView } from './canvas-view.js'
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

interface SessionsLike {
  binding(sessionId: string): { readonly session: SessionFaceLike } | undefined
}

interface ClientContextLike {
  slots: SlotRegistryLike
  sessions: SessionsLike
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
 * Skills and MCP. This plugin contributes the conversation view and uses the
 * public sessions service only when selected Image Nodes require multimodal
 * prompt content that cannot travel through the text-only draft path.
 */
export function createInfiniteCanvasClientPlugin() {
  return {
    inject: ['slots', 'sessions'],
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
