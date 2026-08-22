import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { BrowserSession, type BrowserSessionOptions, type BrowserTab } from '../browser/session.js'
import type { DomSelection } from '../core/types.js'

export interface BrowserSessionRegistryOptions {
  stateDir: string
  /** Persist Chromium profiles across DSH/plugin restarts. Off by default so
   * disabling/uninstalling the plugin does not leave browser auth state behind. */
  persistProfiles?: boolean
  browser?: Omit<BrowserSessionOptions, 'userDataDir' | 'keepProfile'>
}

interface Entry {
  session: BrowserSession
  started: boolean
  profileDir?: string
}

/** One Chromium process/profile per DSH Session. No tab id is meaningful across entries. */
export class BrowserSessionRegistry {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly options: BrowserSessionRegistryOptions) {}

  async for(sessionId: string): Promise<BrowserSession> {
    let entry = this.entries.get(sessionId)
    if (entry === undefined) {
      const persistent = this.options.persistProfiles === true
      const profile = persistent ? path.join(this.options.stateDir, 'browser', encodeURIComponent(sessionId)) : undefined
      if (profile !== undefined) await mkdir(profile, { recursive: true })
      entry = {
        session: new BrowserSession({
          ...(this.options.browser ?? {}),
          ...(profile === undefined ? {} : { userDataDir: profile, keepProfile: true }),
        }),
        started: false,
        profileDir: profile,
      }
      this.entries.set(sessionId, entry)
    }
    if (!entry.started) {
      await entry.session.start()
      entry.started = true
    }
    return entry.session
  }

  async firstTab(sessionId: string): Promise<BrowserTab> {
    return (await this.for(sessionId)).firstTab()
  }

  async tabs(sessionId: string) {
    return (await this.for(sessionId)).tabs()
  }

  async newTab(sessionId: string, url = 'about:blank'): Promise<BrowserTab> {
    return (await this.for(sessionId)).newTab(url)
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    await (await this.for(sessionId)).closeTab(tabId)
  }

  async getTab(sessionId: string, tabId: string): Promise<BrowserTab> {
    return (await this.for(sessionId)).getTab(tabId)
  }

  async inspect(sessionId: string, tabId: string, selector: string) {
    return (await this.getTab(sessionId, tabId)).inspect(selector)
  }

  async validateSelection(sessionId: string, tabId: string, selection: DomSelection) {
    return (await this.getTab(sessionId, tabId)).validateSelection(selection)
  }

  async stop(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (entry === undefined) return
    this.entries.delete(sessionId)
    await entry.session.stop()
    if (entry.profileDir !== undefined && this.options.persistProfiles !== true) {
      await rm(entry.profileDir, { recursive: true, force: true })
    }
  }

  async dispose(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.allSettled(entries.map(async entry => {
      await entry.session.stop()
      if (entry.profileDir !== undefined && this.options.persistProfiles !== true) {
        await rm(entry.profileDir, { recursive: true, force: true })
      }
    }))
  }

  /** Process-local diagnostic used by lifecycle tests and status surfaces. */
  activeSessionIds(): string[] {
    return [...this.entries.keys()]
  }
}
