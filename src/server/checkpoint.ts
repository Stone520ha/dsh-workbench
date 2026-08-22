import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Workspace } from './workspace.js'

interface CheckpointEntry {
  path: string
  existed: boolean
  content?: string
  mode?: number
}

interface CheckpointManifest {
  id: string
  createdAt: number
  entries: CheckpointEntry[]
}

export class CheckpointStore {
  constructor(private readonly stateDir: string) {}

  async create(workspace: Workspace, paths: readonly string[]): Promise<string> {
    const id = randomUUID()
    const entries: CheckpointEntry[] = []
    for (const relativePath of [...new Set(paths)]) {
      const exists = await workspace.exists(relativePath)
      if (!exists) {
        entries.push({ path: relativePath, existed: false })
        continue
      }
      const opened = await workspace.open(relativePath)
      if (opened.content === undefined) throw new Error(`Checkpoint currently supports text files only: ${relativePath}`)
      const absolute = await workspace.policy.resolveForRead(relativePath)
      const info = await stat(absolute)
      entries.push({ path: relativePath, existed: true, content: opened.content, mode: info.mode })
    }
    const manifest: CheckpointManifest = { id, createdAt: Date.now(), entries }
    const dir = path.join(this.stateDir, 'checkpoints')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify(manifest), 'utf8')
    return id
  }

  async restore(workspace: Workspace, id: string, onlyPaths?: ReadonlySet<string>): Promise<void> {
    const manifest = await this.load(id)
    for (const entry of manifest.entries) {
      if (onlyPaths !== undefined && !onlyPaths.has(entry.path)) continue
      if (!entry.existed) {
        if (await workspace.exists(entry.path)) await workspace.remove(entry.path)
        continue
      }
      await workspace.atomicWrite(entry.path, entry.content ?? '')
      if (entry.mode !== undefined) {
        const absolute = await workspace.policy.resolveForRead(entry.path)
        await chmod(absolute, entry.mode)
      }
    }
  }

  async delete(id: string): Promise<void> {
    await rm(path.join(this.stateDir, 'checkpoints', `${id}.json`), { force: true })
  }

  private async load(id: string): Promise<CheckpointManifest> {
    const raw = await readFile(path.join(this.stateDir, 'checkpoints', `${id}.json`), 'utf8')
    return JSON.parse(raw) as CheckpointManifest
  }
}
