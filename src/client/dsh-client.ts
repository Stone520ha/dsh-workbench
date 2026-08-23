import * as React from 'react'
import type { WorkbenchClientTransport } from './transport.js'
import { InfiniteCanvasView } from './canvas-view.js'
import { WorkbenchOverlay } from './overlay.js'

interface SlotRegistryLike {
  inject(name: string, setup: () => (() => void) | void): () => void
  register(options: Record<string, unknown>, component: (props: any) => unknown): () => void
}

interface ClientContextLike {
  slots: SlotRegistryLike
  effect(setup: () => (() => void) | void, label?: string): unknown
}

class WorkbenchOpenStore {
  private sessionId: string | undefined
  private readonly listeners = new Set<() => void>()
  snapshot(): string | undefined { return this.sessionId }
  toggle(sessionId: string): void {
    this.sessionId = this.sessionId === sessionId ? undefined : sessionId
    for (const listener of this.listeners) listener()
  }
  close(): void {
    if (this.sessionId === undefined) return
    this.sessionId = undefined
    for (const listener of this.listeners) listener()
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
}

/**
 * Build the DSH client-half plugin around the installable package's
 * same-origin Host transport. The shell.overlay seat stays additive; the header utility is only a
 * toggle and never replaces DSH's conversation/details owners.
 */
export function createWorkbenchClientPlugin(transport: WorkbenchClientTransport) {
  const opened = new WorkbenchOpenStore()

  function useOpenedSession(): string | undefined {
    const [value, setValue] = React.useState(() => opened.snapshot())
    React.useEffect(() => opened.subscribe(() => setValue(opened.snapshot())), [])
    return value
  }

  function HeaderAction(props: { sessionId: string }): React.ReactNode {
    const openSession = useOpenedSession()
    const active = openSession === String(props.sessionId)
    return React.createElement('button', {
      type: 'button',
      title: active ? 'Close Workbench' : 'Open Workbench',
      'aria-pressed': active,
      onClick: () => opened.toggle(String(props.sessionId)),
      style: {
        border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.25))',
        borderRadius: 8,
        padding: '5px 9px',
        background: active ? 'var(--dsw-alias-bg-selected, rgba(80,110,255,.14))' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
    }, 'Workbench')
  }

  function OverlayRoot(props: { useSessions: (selector: (state: { current?: string }) => unknown) => unknown }): React.ReactNode {
    const openSession = useOpenedSession()
    const current = props.useSessions(state => state.current) as string | undefined
    const sessionId = openSession !== undefined && openSession === current ? current : undefined
    if (sessionId === undefined) return null
    return React.createElement(WorkbenchOverlay, {
      sessionId,
      transport,
      open: true,
      onClose: () => opened.close(),
    })
  }

  return {
    inject: ['slots'],
    apply(ctx: ClientContextLike): void {
      ctx.effect(() => () => opened.close(), 'dsh-workbench: open-state cleanup')

      // Infinite Canvas MVP: DSH remains the Agent/Harness owner. This package
      // contributes only another native conversation view over the same Session.
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: 'canvas', order: -10, label: 'Canvas',
      }, InfiniteCanvasView))

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities', id: 'dsh-workbench-toggle', order: 90, label: 'Workbench',
      }, HeaderAction))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'dsh-workbench', order: 100, label: 'Workbench',
      }, OverlayRoot))
    },
  }
}
