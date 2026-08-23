import { InfiniteCanvasView } from './canvas-view.js'

interface SlotRegistryLike {
  inject(name: string, setup: () => (() => void) | void): () => void
  register(options: Record<string, unknown>, component: (props: any) => unknown): () => void
}

interface ClientContextLike {
  slots: SlotRegistryLike
}

/**
 * Canvas-only DSH client contribution.
 *
 * DSH keeps ownership of Session, conversation input, Agent Loop, tools,
 * Skills and MCP. This plugin contributes a native conversation view only.
 */
export function createInfiniteCanvasClientPlugin() {
  return {
    inject: ['slots'],
    apply(ctx: ClientContextLike): void {
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'canvas',
        order: -10,
        label: 'Canvas',
      }, InfiniteCanvasView))
    },
  }
}
