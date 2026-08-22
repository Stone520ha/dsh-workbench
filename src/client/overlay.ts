import * as React from 'react'
import { BrowserWorkbenchController, type BrowserWorkbenchState, type WorkbenchSurface } from './controller.js'
import { buildWorkbenchViewModel } from './view-model.js'
import type { WorkbenchClientTransport } from './transport.js'

export interface WorkbenchOverlayProps {
  sessionId: string
  transport: WorkbenchClientTransport
  open: boolean
  onClose(): void
}

const S = {
  panel: {
    position: 'fixed', top: 12, right: 12, bottom: 12, width: 'min(640px, 46vw)', minWidth: 420,
    zIndex: 2000, pointerEvents: 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    borderRadius: 14, border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.25))',
    background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #111)',
    boxShadow: '0 18px 60px rgba(0,0,0,.18)', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  button: {
    border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.25))', borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))', color: 'inherit', padding: '6px 9px', cursor: 'pointer',
  },
  input: {
    border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.25))', borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-0, transparent)', color: 'inherit', padding: '7px 9px', outline: 'none',
  },
} satisfies Record<string, React.CSSProperties>

export function WorkbenchOverlay(props: WorkbenchOverlayProps): React.ReactNode {
  const controller = React.useMemo(() => new BrowserWorkbenchController(props.sessionId, props.transport), [props.sessionId, props.transport])
  const [state, setState] = React.useState<Readonly<BrowserWorkbenchState>>(() => controller.snapshot())
  const [urlInput, setUrlInput] = React.useState('')

  React.useEffect(() => controller.subscribe(next => {
    setState(next)
    if (next.preview?.url !== undefined) setUrlInput(next.preview.url)
  }), [controller])

  React.useEffect(() => {
    if (props.open && !controller.snapshot().ready) void controller.init().catch(() => undefined)
  }, [controller, props.open])

  if (!props.open) return null
  const vm = buildWorkbenchViewModel(state)
  const h = React.createElement

  const surfaceButton = (surface: WorkbenchSurface, label: string, badge?: number) => h('button', {
    type: 'button', style: { ...S.button, background: state.surface === surface ? 'var(--dsw-alias-bg-selected, rgba(80,110,255,.14))' : S.button.background },
    onClick: () => { controller.setSurface(surface); if (surface === 'console' || surface === 'network') void controller.refreshDiagnostics().catch(() => undefined) },
  }, badge ? `${label} ${badge}` : label)

  return h('aside', { style: S.panel, role: 'complementary', 'aria-label': 'DSH Workbench' },
    h('header', { style: { ...S.row, padding: 10, borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.2))' } },
      h('strong', { style: { flex: 1 } }, 'Workbench'),
      state.busy ? h('span', { style: { fontSize: 12, opacity: .65 } }, 'Working…') : null,
      h('button', { type: 'button', style: S.button, onClick: props.onClose, 'aria-label': 'Close Workbench' }, '×'),
    ),
    h('nav', { style: { ...S.row, padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.2))' } },
      surfaceButton('browser', 'Browser'),
      surfaceButton('changes', 'Changes', vm.pendingHunks || undefined),
      surfaceButton('console', 'Console', state.console.length || undefined),
      surfaceButton('network', 'Network', state.network.length || undefined),
    ),
    state.error ? h('div', { style: { margin: 8, padding: 8, borderRadius: 8, background: 'rgba(220,60,60,.12)', color: 'var(--dsw-alias-label-danger, #b42318)', fontSize: 12 } }, state.error) : null,
    h('main', { style: { flex: 1, minHeight: 0, overflow: 'auto' } },
      state.surface === 'browser' ? renderBrowser(h, controller, state, vm, urlInput, setUrlInput) : null,
      state.surface === 'changes' ? renderChanges(h, controller, state, vm) : null,
      state.surface === 'console' ? renderConsole(h, state) : null,
      state.surface === 'network' ? renderNetwork(h, state) : null,
    ),
  )
}

function renderBrowser(
  h: typeof React.createElement,
  controller: BrowserWorkbenchController,
  state: Readonly<BrowserWorkbenchState>,
  vm: ReturnType<typeof buildWorkbenchViewModel>,
  urlInput: string,
  setUrlInput: (value: string) => void,
): React.ReactNode {
  const tabs = state.tabs.filter(tab => tab.type === 'page')
  const selected = state.selected?.element
  const preview = state.preview
  const selectedBox = selected !== undefined && preview !== undefined ? {
    left: `${selected.rect.x / preview.viewport.width * 100}%`,
    top: `${selected.rect.y / preview.viewport.height * 100}%`,
    width: `${selected.rect.width / preview.viewport.width * 100}%`,
    height: `${selected.rect.height / preview.viewport.height * 100}%`,
  } : undefined

  return h('section', { style: { padding: 10, display: 'grid', gap: 10 } },
    h('div', { style: S.row },
      h('button', { type: 'button', style: S.button, onClick: () => void controller.back().catch(() => undefined) }, '←'),
      h('button', { type: 'button', style: S.button, onClick: () => void controller.forward().catch(() => undefined) }, '→'),
      h('button', { type: 'button', style: S.button, onClick: () => void controller.reload().catch(() => undefined) }, '↻'),
      h('input', {
        value: urlInput, style: { ...S.input, flex: 1 }, spellCheck: false,
        onChange: (event: Event) => setUrlInput((event.target as HTMLInputElement).value),
        onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Enter') void controller.navigate(urlInput).catch(() => undefined) },
        'aria-label': 'Browser URL',
      }),
      h('button', { type: 'button', style: S.button, onClick: () => void controller.navigate(urlInput).catch(() => undefined) }, 'Go'),
    ),
    h('div', { style: { ...S.row, overflowX: 'auto', paddingBottom: 2 } },
      ...tabs.map(tab => h('button', {
        key: tab.id, type: 'button', title: tab.url,
        style: { ...S.button, maxWidth: 170, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: tab.id === state.activeTabId ? 'var(--dsw-alias-bg-selected, rgba(80,110,255,.14))' : S.button.background },
        onClick: () => void controller.selectTab(tab.id).catch(() => undefined),
      }, tab.title || tab.url || 'New tab')),
      h('button', { type: 'button', style: S.button, onClick: () => void controller.newTab().catch(() => undefined) }, '+'),
      tabs.length > 1 ? h('button', { type: 'button', style: S.button, onClick: () => void controller.closeActiveTab().catch(() => undefined) }, '× tab') : null,
    ),
    preview === undefined ? h('div', { style: { padding: 30, textAlign: 'center', opacity: .6 } }, state.ready ? 'No preview' : 'Starting Chromium…') :
      h('div', {
        style: { position: 'relative', width: '100%', overflow: 'hidden', borderRadius: 10, border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.25))', background: '#fff', cursor: 'crosshair' },
        title: 'Click an element to select it',
        onClick: (event: MouseEvent) => {
          const target = event.currentTarget as HTMLElement
          const rect = target.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          void controller.inspectNormalized((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height).catch(() => undefined)
        },
      },
        h('img', { alt: vm.title, src: `data:image/png;base64,${preview.screenshotBase64}`, draggable: false, style: { display: 'block', width: '100%', height: 'auto', userSelect: 'none' } }),
        selectedBox ? h('div', { style: { position: 'absolute', pointerEvents: 'none', border: '2px solid #3b82f6', background: 'rgba(59,130,246,.10)', boxSizing: 'border-box', ...selectedBox } }) : null,
      ),
    selected === undefined ? h('div', { style: { fontSize: 12, opacity: .65 } }, 'Click the preview to select a DOM element.') :
      h('div', { style: { padding: 10, borderRadius: 10, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07))' } },
        h('div', { style: S.row }, h('strong', null, vm.selectedLabel), h('code', { style: { fontSize: 11, opacity: .7 } }, selected.selector)),
        h('div', { style: { marginTop: 6, fontSize: 12, opacity: .8, whiteSpace: 'pre-wrap' } }, selected.textContent.slice(0, 600)),
        h('div', { style: { marginTop: 6, fontSize: 11, opacity: .65 } }, `font ${selected.styles.fontSize || '?'} · radius ${selected.styles.borderRadius || '?'} · ${selected.rect.width.toFixed(0)}×${selected.rect.height.toFixed(0)}`),
      ),
    h('textarea', {
      value: state.instruction, rows: 3, style: { ...S.input, resize: 'vertical', width: '100%', boxSizing: 'border-box' },
      placeholder: 'Describe what should change on the selected element…',
      onChange: (event: Event) => controller.setInstruction((event.target as HTMLTextAreaElement).value),
    }),
    h('div', { style: { ...S.row, justifyContent: 'flex-end' } },
      state.lastCheckpointId ? h('button', { type: 'button', style: S.button, onClick: () => void controller.undoLastApply().catch(() => undefined) }, 'Undo last apply') : null,
      h('button', { type: 'button', disabled: !vm.canAskAgent, style: { ...S.button, opacity: vm.canAskAgent ? 1 : .45 }, onClick: () => void controller.askAgent().catch(() => undefined) }, 'Ask Agent to propose changes'),
    ),
  )
}

function renderChanges(
  h: typeof React.createElement,
  controller: BrowserWorkbenchController,
  state: Readonly<BrowserWorkbenchState>,
  vm: ReturnType<typeof buildWorkbenchViewModel>,
): React.ReactNode {
  const change = state.changeSet
  if (change === undefined) return h('div', { style: { padding: 24, opacity: .65 } }, 'No proposed changes yet.')
  return h('section', { style: { padding: 10, display: 'grid', gap: 10 } },
    h('div', null,
      h('strong', null, change.reason),
      h('div', { style: { marginTop: 4, fontSize: 12, opacity: .65 } }, `${change.status} · ${change.patches.length} file patch(es)`),
    ),
    h('div', { style: S.row },
      h('button', { type: 'button', style: S.button, onClick: () => void controller.acceptAll().catch(() => undefined) }, 'Accept all'),
      h('button', { type: 'button', style: S.button, onClick: () => void controller.rejectAll().catch(() => undefined) }, 'Reject all'),
      h('span', { style: { marginLeft: 'auto', fontSize: 12, opacity: .65 } }, `${vm.pendingHunks} pending`),
    ),
    ...vm.hunks.map(hunk => h('article', { key: hunk.id, style: { border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.25))', borderRadius: 10, overflow: 'hidden' } },
      h('header', { style: { ...S.row, padding: 8, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))' } },
        h('code', { style: { flex: 1, fontSize: 12 } }, hunk.path),
        h('span', { style: { fontSize: 11, opacity: .6 } }, hunk.header),
        h('strong', { style: { fontSize: 11, textTransform: 'uppercase' } }, hunk.decision),
      ),
      h('pre', { style: { margin: 0, padding: 8, overflowX: 'auto', fontSize: 11, lineHeight: 1.5, background: 'var(--dsw-alias-bg-layer-0, transparent)' } },
        hunk.lines.map((line, index) => h('div', { key: `${hunk.id}:${index}`, style: { whiteSpace: 'pre', background: line.type === 'add' ? 'rgba(34,197,94,.10)' : line.type === 'delete' ? 'rgba(239,68,68,.10)' : 'transparent' } }, `${line.marker}${line.text}`)),
      ),
      h('div', { style: { display: 'grid', gap: 8, padding: 8 } },
        h('div', { style: S.row },
          h('button', { type: 'button', style: S.button, onClick: () => void controller.reviewHunk(hunk.path, hunk.id, 'accepted').catch(() => undefined) }, 'Accept hunk'),
          h('button', { type: 'button', style: S.button, onClick: () => void controller.reviewHunk(hunk.path, hunk.id, 'rejected').catch(() => undefined) }, 'Reject hunk'),
        ),
        h('textarea', {
          value: hunk.comment, rows: 2, style: { ...S.input, resize: 'vertical', width: '100%', boxSizing: 'border-box' },
          placeholder: 'Comment on this hunk, then ask Agent to revise…',
          onChange: (event: Event) => controller.setComment(hunk.id, (event.target as HTMLTextAreaElement).value),
        }),
      ),
    )),
    h('div', { style: { ...S.row, justifyContent: 'flex-end', position: 'sticky', bottom: 0, padding: 8, borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1, #fff)' } },
      Object.values(state.comments).some(value => value.trim()) ? h('button', { type: 'button', style: S.button, onClick: () => void controller.reviseFromComments().catch(() => undefined) }, 'Ask Agent to revise') : null,
      h('button', { type: 'button', disabled: !vm.canApply, style: { ...S.button, opacity: vm.canApply ? 1 : .45 }, onClick: () => void controller.applyReviewed().catch(() => undefined) }, 'Apply reviewed changes'),
    ),
  )
}

function renderConsole(h: typeof React.createElement, state: Readonly<BrowserWorkbenchState>): React.ReactNode {
  return h('section', { style: { padding: 10, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 } },
    ...(state.console.length === 0
      ? [h('div', { style: { opacity: .6 } }, 'No console messages captured.')]
      : state.console.map((entry, index) => h('div', { key: `${entry.timestamp}:${index}`, style: { padding: '5px 0', borderBottom: '1px solid rgba(127,127,127,.12)' } }, `[${entry.type}] ${entry.text}`))),
  )
}

function renderNetwork(h: typeof React.createElement, state: Readonly<BrowserWorkbenchState>): React.ReactNode {
  return h('section', { style: { padding: 10, fontSize: 11 } },
    ...(state.network.length === 0
      ? [h('div', { style: { opacity: .6 } }, 'No network requests captured.')]
      : state.network.map(entry => h('div', { key: entry.requestId, style: { display: 'grid', gridTemplateColumns: '54px 48px 1fr', gap: 6, padding: '6px 0', borderBottom: '1px solid rgba(127,127,127,.12)' } },
        h('strong', null, entry.method),
        h('span', null, entry.status ?? '…'),
        h('span', { title: entry.url, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.url),
      ))),
  )
}
