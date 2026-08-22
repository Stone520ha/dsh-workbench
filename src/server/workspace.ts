import { mkdir, readFile, readdir, realpath, stat, writeFile, rename, unlink, lstat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { contentVersion } from '../core/version.js'
import type { Artifact } from '../core/types.js'

export interface WorkspaceEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
}

export interface OpenedArtifact {
  artifact: Artifact
  content?: string
}

export class WorkspacePolicy {
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  get workspaceRoot(): string {
    return this.root
  }

  async resolveForRead(relativePath: string): Promise<string> {
    const candidate = this.safeCandidate(relativePath)
    const resolved = await realpath(candidate).catch(() => candidate)
    this.assertInside(resolved)
    return resolved
  }

  async resolveForWrite(relativePath: string): Promise<string> {
    const candidate = this.safeCandidate(relativePath)
    const parent = path.dirname(candidate)
    const parentReal = await realpath(parent).catch(() => parent)
    this.assertInside(parentReal)
    const info = await lstat(candidate).catch(() => undefined)
    if (info?.isSymbolicLink()) {
      const target = await realpath(candidate)
      this.assertInside(target)
    }
    return candidate
  }

  private safeCandidate(relativePath: string): string {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') throw codedError('INVALID_PATH', 'Path must be non-empty')
    if (path.isAbsolute(relativePath)) throw codedError('PATH_ESCAPE', 'Absolute paths are not allowed')
    const normalized = path.normalize(relativePath)
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError('PATH_ESCAPE', 'Path traversal is not allowed')
    const candidate = path.resolve(this.root, normalized)
    this.assertInside(candidate)
    return candidate
  }

  private assertInside(candidate: string): void {
    const rel = path.relative(this.root, candidate)
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw codedError('PATH_ESCAPE', `Path leaves workspace: ${candidate}`)
  }
}

export class Workspace {
  readonly policy: WorkspacePolicy
  constructor(root: string, private readonly maxTextBytes = 2 * 1024 * 1024) {
    this.policy = new WorkspacePolicy(root)
  }

  async list(relativePath = ''): Promise<WorkspaceEntry[]> {
    const root = relativePath === '' ? this.policy.workspaceRoot : await this.policy.resolveForRead(relativePath)
    const rows = await readdir(root, { withFileTypes: true })
    return rows
      .filter(row => row.isFile() || row.isDirectory())
      .map(row => ({
        name: row.name,
        path: relativePath === '' ? row.name : path.posix.join(relativePath.replaceAll('\\', '/'), row.name),
        kind: row.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async open(relativePath: string): Promise<OpenedArtifact> {
    const resolved = await this.policy.resolveForRead(relativePath)
    const info = await stat(resolved)
    if (!info.isFile()) throw codedError('NOT_FILE', `Not a file: ${relativePath}`)
    if (info.size > this.maxTextBytes) {
      return {
        artifact: {
          id: artifactId(relativePath), uri: relativePath, kind: 'binary', version: `size:${info.size}`,
          capabilities: { read: false, edit: false, select: false, diff: false, preview: false },
        },
      }
    }
    const bytes = await readFile(resolved)
    if (bytes.includes(0)) {
      return {
        artifact: {
          id: artifactId(relativePath), uri: relativePath, kind: 'binary', version: contentVersion(bytes),
          capabilities: { read: false, edit: false, select: false, diff: false, preview: false },
        },
      }
    }
    const content = bytes.toString('utf8')
    return {
      artifact: {
        id: artifactId(relativePath), uri: relativePath, kind: classifyText(relativePath), version: contentVersion(content),
        capabilities: { read: true, edit: true, select: true, diff: true, preview: true },
      },
      content,
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(await this.policy.resolveForRead(relativePath))
      return true
    } catch {
      return false
    }
  }

  async currentVersion(relativePath: string): Promise<string | null> {
    if (!await this.exists(relativePath)) return null
    const opened = await this.open(relativePath)
    return opened.artifact.version
  }

  async atomicWrite(relativePath: string, content: string): Promise<void> {
    const target = await this.policy.resolveForWrite(relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.dsh-workbench-${randomUUID()}.tmp`
    await writeFile(temp, content, 'utf8')
    await rename(temp, target)
  }

  async remove(relativePath: string): Promise<void> {
    const target = await this.policy.resolveForWrite(relativePath)
    await unlink(target)
  }
}

function artifactId(uri: string): string {
  return `file:${uri.replaceAll('\\', '/')}`
}

function classifyText(uri: string): Artifact['kind'] {
  const ext = path.extname(uri).toLowerCase()
  if (['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.html', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.sh'].includes(ext)) return 'code'
  return 'text'
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
