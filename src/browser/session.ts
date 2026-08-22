import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { contentVersion } from '../core/version.js'
import type { Artifact, DomSelection } from '../core/types.js'
import { CdpConnection } from './cdp.js'
import { BrowserPolicy, type BrowserPolicyOptions } from './policy.js'

export interface BrowserSessionOptions extends BrowserPolicyOptions {
  executablePath?: string
  headless?: boolean
  userDataDir?: string
  keepProfile?: boolean
  launchArgs?: readonly string[]
}

export interface BrowserTabInfo {
  id: string
  title: string
  url: string
  type: string
  webSocketDebuggerUrl?: string
}

export interface InspectedElement {
  selector: string
  tagName: string
  id: string
  className: string
  textContent: string
  rect: { x: number; y: number; width: number; height: number; top: number; left: number }
  styles: Record<string, string>
}

export interface BrowserConsoleEntry {
  type: string
  text: string
  timestamp: number
}

export interface BrowserNetworkEntry {
  requestId: string
  url: string
  method: string
  resourceType?: string
  status?: number
  mimeType?: string
}

export interface WebSelectionResult {
  artifact: Artifact
  selection: DomSelection
  element: InspectedElement
}

export interface BrowserPreview {
  artifact: Artifact
  url: string
  title: string
  viewport: { width: number; height: number; deviceScaleFactor: number }
  screenshotBase64: string
}

export class BrowserSession {
  private readonly policy: BrowserPolicy
  private process: ChildProcess | undefined
  private profileDir: string | undefined
  private port: number | undefined
  private readonly connections = new Map<string, CdpConnection>()
  private readonly tabCache = new Map<string, BrowserTab>()

  constructor(private readonly options: BrowserSessionOptions = {}) {
    this.policy = new BrowserPolicy(options)
  }

  async start(): Promise<void> {
    if (this.process !== undefined) return
    this.profileDir = this.options.userDataDir ?? await mkdtemp(path.join(tmpdir(), 'dsh-workbench-chromium-'))
    const executable = this.options.executablePath ?? '/usr/bin/chromium'
    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      ...(this.options.headless ?? true ? ['--headless=new', '--disable-gpu'] : []),
      ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : []),
      ...(this.options.launchArgs ?? []),
      'about:blank',
    ]
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.process = child
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += String(chunk).slice(-8_000) })
    try {
      const activePortFile = path.join(this.profileDir, 'DevToolsActivePort')
      this.port = await waitForDevToolsPort(activePortFile, 10_000, child)
    } catch (error) {
      child.kill('SIGKILL')
      await waitForChildExit(child, 2_000)
      this.process = undefined
      this.port = undefined
      const profileDir = this.profileDir
      if (profileDir !== undefined && this.options.userDataDir === undefined && !this.options.keepProfile) {
        await rm(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }).catch(() => undefined)
        this.profileDir = undefined
      }
      throw new Error(`Chromium failed to start: ${error instanceof Error ? error.message : String(error)}\n${stderr}`)
    }
  }

  async tabs(): Promise<BrowserTabInfo[]> {
    await this.start()
    const response = await fetch(`${this.httpBase()}/json/list`)
    if (!response.ok) throw new Error(`Chromium /json/list failed: HTTP ${response.status}`)
    return await response.json() as BrowserTabInfo[]
  }

  async newTab(url = 'about:blank'): Promise<BrowserTab> {
    await this.start()
    if (url !== 'about:blank') this.policy.assertUrl(url)
    const response = await fetch(`${this.httpBase()}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    if (!response.ok) throw new Error(`Chromium /json/new failed: HTTP ${response.status}`)
    const info = await response.json() as BrowserTabInfo
    return this.tabFromInfo(info)
  }

  async firstTab(): Promise<BrowserTab> {
    const tabs = await this.tabs()
    const page = tabs.find(tab => tab.type === 'page')
    if (page === undefined) return this.newTab()
    return this.tabFromInfo(page)
  }

  async getTab(id: string): Promise<BrowserTab> {
    const info = (await this.tabs()).find(tab => tab.id === id && tab.type === 'page')
    if (info === undefined) throw codedError('BROWSER_TAB_NOT_FOUND', `Unknown browser tab: ${id}`)
    return this.tabFromInfo(info)
  }

  async closeTab(id: string): Promise<void> {
    this.tabCache.delete(id)
    this.connections.get(id)?.close()
    this.connections.delete(id)
    const response = await fetch(`${this.httpBase()}/json/close/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`Chromium close tab failed: HTTP ${response.status}`)
  }

  async stop(): Promise<void> {
    this.tabCache.clear()
    for (const connection of this.connections.values()) connection.close()
    this.connections.clear()
    const child = this.process
    this.process = undefined
    this.port = undefined
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM')
      const exited = await waitForChildExit(child, 2_000)
      if (!exited && child.exitCode === null) {
        child.kill('SIGKILL')
        await waitForChildExit(child, 2_000)
      }
    }
    if (this.profileDir !== undefined && this.options.userDataDir === undefined && !this.options.keepProfile) {
      // Chromium may finish filesystem journal work a few milliseconds after
      // process exit. Node's rm retry contract handles ENOTEMPTY/EBUSY/EPERM
      // without turning teardown into a flaky test or leaving auth state.
      await rm(this.profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
    }
    this.profileDir = undefined
  }

  private tabFromInfo(info: BrowserTabInfo): BrowserTab {
    if (info.webSocketDebuggerUrl === undefined) throw new Error(`Tab has no websocket debugger URL: ${info.id}`)
    const cached = this.tabCache.get(info.id)
    if (cached !== undefined) return cached
    let connection = this.connections.get(info.id)
    if (connection === undefined) {
      connection = new CdpConnection(info.webSocketDebuggerUrl)
      this.connections.set(info.id, connection)
    }
    const tab = new BrowserTab(info.id, connection, this.policy)
    this.tabCache.set(info.id, tab)
    return tab
  }

  private httpBase(): string {
    if (this.port === undefined) throw new Error('BrowserSession is not started')
    return `http://127.0.0.1:${this.port}`
  }
}

export class BrowserTab {
  private readonly consoleBuffer: BrowserConsoleEntry[] = []
  private readonly networkBuffer = new Map<string, BrowserNetworkEntry>()
  private observabilityStarted = false

  constructor(readonly id: string, private readonly cdp: CdpConnection, private readonly policy: BrowserPolicy) {}

  async startObservability(): Promise<void> {
    if (this.observabilityStarted) return
    this.observabilityStarted = true
    await this.cdp.send('Runtime.enable')
    await this.cdp.send('Network.enable')
    this.cdp.on<any>('Runtime.consoleAPICalled', event => {
      const text = (event.args ?? []).map((arg: any) => {
        if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value)
        return arg.description ?? arg.type ?? ''
      }).join(' ')
      this.consoleBuffer.push({ type: event.type ?? 'log', text, timestamp: event.timestamp ?? Date.now() / 1000 })
      if (this.consoleBuffer.length > 500) this.consoleBuffer.shift()
    })
    this.cdp.on<any>('Network.requestWillBeSent', event => {
      const request = event.request ?? {}
      this.networkBuffer.set(event.requestId, {
        requestId: event.requestId,
        url: request.url ?? '',
        method: request.method ?? 'GET',
        resourceType: event.type,
      })
      if (this.networkBuffer.size > 1000) this.networkBuffer.delete(this.networkBuffer.keys().next().value as string)
    })
    this.cdp.on<any>('Network.responseReceived', event => {
      const row = this.networkBuffer.get(event.requestId)
      if (row === undefined) return
      row.status = event.response?.status
      row.mimeType = event.response?.mimeType
    })
  }

  consoleEntries(): BrowserConsoleEntry[] {
    return structuredClone(this.consoleBuffer)
  }

  networkEntries(): BrowserNetworkEntry[] {
    return structuredClone([...this.networkBuffer.values()])
  }

  async pickElement(timeoutMs = 30_000): Promise<WebSelectionResult> {
    await this.cdp.send('Runtime.enable')
    const token = randomUUID().replaceAll('-', '')
    const binding = `__dshWorkbenchPick_${token}`
    await this.cdp.send('Runtime.addBinding', { name: binding })
    const picked = new Promise<InspectedElement>((resolve, reject) => {
      const timeout = setTimeout(() => {
        dispose()
        reject(codedError('DOM_PICK_TIMEOUT', 'Timed out waiting for an element selection'))
      }, timeoutMs)
      const dispose = this.cdp.on<any>('Runtime.bindingCalled', event => {
        if (event.name !== binding) return
        try {
          const payload = JSON.parse(event.payload) as { cancelled?: boolean; element?: InspectedElement }
          if (payload.cancelled) throw codedError('DOM_PICK_CANCELLED', 'Element selection cancelled')
          if (payload.element === undefined) throw codedError('DOM_PICK_INVALID', 'Inspector returned no element')
          clearTimeout(timeout)
          dispose()
          resolve(payload.element)
        } catch (error) {
          clearTimeout(timeout)
          dispose()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })

    const script = inspectorScript(binding)
    try {
      const installed = await this.cdp.send<any>('Runtime.evaluate', { expression: script, returnByValue: true })
      if (installed.exceptionDetails !== undefined) throw new Error(`Inspector injection failed: ${installed.exceptionDetails.text ?? 'unknown error'}`)
      const element = await picked
      const snapshot = await this.snapshotArtifact()
      return {
        artifact: snapshot.artifact,
        element,
        selection: {
          kind: 'dom-node', artifactId: snapshot.artifact.id, version: snapshot.artifact.version,
          selector: element.selector, url: snapshot.url,
        },
      }
    } finally {
      await this.cdp.send('Runtime.evaluate', { expression: `globalThis.__dshWorkbenchInspectorCleanup?.()` }).catch(() => undefined)
      await this.cdp.send('Runtime.removeBinding', { name: binding }).catch(() => undefined)
    }
  }

  async navigate(rawUrl: string): Promise<void> {
    const url = this.policy.assertUrl(rawUrl).toString()
    await this.cdp.send('Page.enable')
    const loaded = this.cdp.once('Page.loadEventFired', 10_000)
    const result = await this.cdp.send<{ errorText?: string }>('Page.navigate', { url })
    if (result.errorText) {
      // Consume the event promise so a failed navigation cannot leak a later
      // unhandled timeout rejection into the test/session lifecycle.
      void loaded.catch(() => undefined)
      throw new Error(`Navigation failed: ${result.errorText}`)
    }
    await loaded
  }

  async setContent(html: string): Promise<void> {
    await this.cdp.send('Page.enable')
    const tree = await this.cdp.send<any>('Page.getFrameTree')
    const frameId = tree.frameTree?.frame?.id
    if (typeof frameId !== 'string') throw new Error('Chromium did not return a root frame id')
    await this.cdp.send('Page.setDocumentContent', { frameId, html })
    await this.cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.cdp.send<any>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    })
    if (result.exceptionDetails !== undefined) throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text ?? 'unknown exception'}`)
    return result.result?.value as T
  }

  async back(): Promise<void> {
    await this.cdp.send('Page.enable')
    const history = await this.cdp.send<any>('Page.getNavigationHistory')
    const index = Number(history.currentIndex ?? 0)
    const entry = history.entries?.[index - 1]
    if (entry?.id === undefined) return
    const loaded = this.cdp.once('Page.loadEventFired', 10_000)
    await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id })
    await loaded.catch(() => undefined)
  }

  async forward(): Promise<void> {
    await this.cdp.send('Page.enable')
    const history = await this.cdp.send<any>('Page.getNavigationHistory')
    const index = Number(history.currentIndex ?? 0)
    const entry = history.entries?.[index + 1]
    if (entry?.id === undefined) return
    const loaded = this.cdp.once('Page.loadEventFired', 10_000)
    await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id })
    await loaded.catch(() => undefined)
  }

  async reload(): Promise<void> {
    await this.cdp.send('Page.enable')
    const loaded = this.cdp.once('Page.loadEventFired', 10_000)
    await this.cdp.send('Page.reload', { ignoreCache: false })
    await loaded.catch(() => undefined)
  }

  async viewport(): Promise<{ width: number; height: number; deviceScaleFactor: number }> {
    return this.evaluate(`(() => ({
      width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
      height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1),
      deviceScaleFactor: window.devicePixelRatio || 1
    }))()`)
  }

  async preview(): Promise<BrowserPreview> {
    const snapshot = await this.snapshotArtifact()
    const viewport = await this.viewport()
    const screenshot = await this.screenshot()
    return {
      artifact: snapshot.artifact,
      url: snapshot.url,
      title: snapshot.artifact.title ?? '',
      viewport,
      screenshotBase64: Buffer.from(screenshot).toString('base64'),
    }
  }

  async inspectPoint(x: number, y: number): Promise<WebSelectionResult> {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw codedError('INVALID_ARGUMENT', 'Browser point must contain finite non-negative coordinates')
    }
    const element = await this.evaluate<InspectedElement | null>(`(() => {
      const x = ${JSON.stringify(x)};
      const y = ${JSON.stringify(y)};
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const selectorFor = ${selectorFunctionSource()};
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        selector: selectorFor(el), tagName: el.tagName, id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        textContent: (el.textContent || '').trim().slice(0,4000),
        rect:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,left:r.left},
        styles:{display:s.display,position:s.position,color:s.color,backgroundColor:s.backgroundColor,
          fontSize:s.fontSize,fontWeight:s.fontWeight,borderRadius:s.borderRadius,padding:s.padding,margin:s.margin}
      };
    })()`)
    if (element === null) throw codedError('DOM_TARGET_NOT_FOUND', `No element at point ${x},${y}`)
    const snapshot = await this.snapshotArtifact()
    return {
      artifact: snapshot.artifact,
      element,
      selection: {
        kind: 'dom-node', artifactId: snapshot.artifact.id, version: snapshot.artifact.version,
        selector: element.selector, url: snapshot.url,
      },
    }
  }

  async snapshotArtifact(): Promise<{ artifact: Artifact; html: string; url: string }> {
    const state = await this.evaluate<{ html: string; url: string; title: string }>(`(() => ({html: document.documentElement.outerHTML, url: location.href, title: document.title}))()`)
    const version = contentVersion(state.html)
    return {
      artifact: {
        id: `web:${state.url}`,
        uri: state.url,
        kind: 'web',
        version,
        title: state.title,
        capabilities: { read: true, edit: false, select: true, diff: false, preview: true },
      },
      html: state.html,
      url: state.url,
    }
  }

  async inspect(selector: string): Promise<WebSelectionResult> {
    if (!selector.trim()) throw new Error('selector must be non-empty')
    const encoded = JSON.stringify(selector)
    const element = await this.evaluate<InspectedElement | null>(`(() => {
      const selector = ${encoded};
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        selector,
        tagName: el.tagName,
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        textContent: (el.textContent || '').trim().slice(0, 4000),
        rect: {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,left:r.left},
        styles: {
          display: s.display,
          position: s.position,
          color: s.color,
          backgroundColor: s.backgroundColor,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          borderRadius: s.borderRadius,
          padding: s.padding,
          margin: s.margin
        }
      };
    })()`)
    if (element === null) throw codedError('DOM_TARGET_NOT_FOUND', `No element matches selector: ${selector}`)
    const snapshot = await this.snapshotArtifact()
    return {
      artifact: snapshot.artifact,
      element,
      selection: {
        kind: 'dom-node',
        artifactId: snapshot.artifact.id,
        version: snapshot.artifact.version,
        selector,
        url: snapshot.url,
      },
    }
  }

  async validateSelection(selection: DomSelection): Promise<WebSelectionResult> {
    const snapshot = await this.snapshotArtifact()
    if (selection.artifactId !== snapshot.artifact.id || selection.url !== snapshot.url) {
      throw codedError('SELECTION_ARTIFACT_MISMATCH', `DOM selection no longer belongs to the current page: ${snapshot.url}`)
    }
    if (selection.version !== snapshot.artifact.version) {
      throw codedError('VERSION_CONFLICT', `DOM selection is stale: selected ${selection.version}, current ${snapshot.artifact.version}`)
    }
    const element = await this.inspect(selection.selector)
    return element
  }

  async screenshot(): Promise<Uint8Array> {
    await this.cdp.send('Page.enable')
    const result = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', fromSurface: true })
    return Buffer.from(result.data, 'base64')
  }
}


function selectorFunctionSource(): string {
  return `(el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const peers = [...parent.children].filter(x => x.tagName === node.tagName);
        if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }`
}

function inspectorScript(binding: string): string {
  const bindingLiteral = JSON.stringify(binding)
  return `(() => {
    globalThis.__dshWorkbenchInspectorCleanup?.();
    const binding = globalThis[${bindingLiteral}];
    if (typeof binding !== 'function') throw new Error('Workbench inspector binding missing');
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:'fixed', pointerEvents:'none', zIndex:'2147483647', border:'2px solid #3b82f6',
      background:'rgba(59,130,246,.12)', display:'none', boxSizing:'border-box'
    });
    document.documentElement.appendChild(overlay);
    const selectorFor = (el) => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.documentElement) {
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const peers = [...parent.children].filter(x => x.tagName === node.tagName);
          if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };
    const info = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        selector: selectorFor(el), tagName: el.tagName, id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        textContent: (el.textContent || '').trim().slice(0,4000),
        rect:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,left:r.left},
        styles:{display:s.display,position:s.position,color:s.color,backgroundColor:s.backgroundColor,
          fontSize:s.fontSize,fontWeight:s.fontWeight,borderRadius:s.borderRadius,padding:s.padding,margin:s.margin}
      };
    };
    const hover = (event) => {
      const el = event.target;
      if (!(el instanceof Element) || el === overlay) return;
      const r = el.getBoundingClientRect();
      Object.assign(overlay.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    };
    const click = (event) => {
      const el = event.target;
      if (!(el instanceof Element) || el === overlay) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      binding(JSON.stringify({element:info(el)}));
      cleanup();
    };
    const key = (event) => { if (event.key === 'Escape') { binding(JSON.stringify({cancelled:true})); cleanup(); } };
    const cleanup = () => {
      document.removeEventListener('mousemove', hover, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      overlay.remove();
      if (globalThis.__dshWorkbenchInspectorCleanup === cleanup) delete globalThis.__dshWorkbenchInspectorCleanup;
    };
    globalThis.__dshWorkbenchInspectorCleanup = cleanup;
    document.addEventListener('mousemove', hover, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return true;
  })()`;
}


async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return true
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      resolve(value)
    }
    const onExit = (): void => finish(true)
    const timer = setTimeout(() => finish(child.exitCode !== null), timeoutMs)
    child.once('exit', onExit)
  })
}

async function waitForDevToolsPort(file: string, timeoutMs: number, child: ChildProcess): Promise<number> {
  const started = Date.now()
  let lastText = ''
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Chromium exited with code ${child.exitCode}`)
    try {
      const text = await readFile(file, 'utf8')
      lastText = text
      const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
      if (/^\d+$/.test(firstLine)) {
        const port = Number(firstLine)
        if (Number.isInteger(port) && port > 0 && port <= 65535) return port
      }
    } catch {
      // The file may not exist yet; Chromium creates it asynchronously.
    }
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  const suffix = lastText.length === 0 ? '' : ` (last content: ${JSON.stringify(lastText)})`
  throw new Error(`Timed out waiting for a valid Chromium DevTools port in ${file}${suffix}`)
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
