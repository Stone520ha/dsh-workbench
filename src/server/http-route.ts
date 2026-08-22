import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkbenchRpcRequest, WorkbenchRpcRouter } from './rpc.js'

export interface WebServerRouteRegistrar {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export interface WorkbenchHttpRouteOptions {
  path?: string
  maxBodyBytes?: number
}

interface ErrorEnvelope {
  ok: false
  error: { code: string; message: string }
}

interface SuccessEnvelope {
  ok: true
  value: unknown
}

export type WorkbenchHttpEnvelope = ErrorEnvelope | SuccessEnvelope

/** Register the installable-package transport. This is deliberately same-origin
 * HTTP rather than Cordis Runner's package-private host.call, which is only
 * available to dynamic closure packages. */
export function registerWorkbenchHttpRoute(
  webServer: WebServerRouteRegistrar,
  router: WorkbenchRpcRouter,
  options: WorkbenchHttpRouteOptions = {},
): () => void {
  const routePath = options.path ?? '/api/dsh-workbench/call'
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024
  if (!routePath.startsWith('/') || routePath.endsWith('/')) throw new Error('Workbench route path must be an absolute path without trailing slash')
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1024) throw new Error('Workbench maxBodyBytes must be a safe integer >= 1024')

  return webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req, res) => {
      setCommonHeaders(res)
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        writeJson(res, 405, errorEnvelope('METHOD_NOT_ALLOWED', 'Workbench RPC accepts POST only'))
        return
      }
      if (!isJson(req.headers['content-type'])) {
        writeJson(res, 415, errorEnvelope('UNSUPPORTED_MEDIA_TYPE', 'Workbench RPC requires application/json'))
        return
      }
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        writeJson(res, 403, errorEnvelope('REMOTE_ACCESS_DENIED', 'Workbench RPC is local-only in this release'))
        return
      }
      if (!sameOrigin(req)) {
        writeJson(res, 403, errorEnvelope('ORIGIN_DENIED', 'Workbench RPC requires a same-origin request'))
        return
      }

      let request: WorkbenchRpcRequest
      try {
        const body = await readBody(req, maxBodyBytes)
        const parsed: unknown = JSON.parse(body)
        request = validateRequest(parsed)
      } catch (error) {
        const normalized = normalizeError(error, 'INVALID_REQUEST')
        writeJson(res, normalized.code === 'BODY_TOO_LARGE' ? 413 : 400, errorEnvelope(normalized.code, normalized.message))
        return
      }

      try {
        const value = await router.call(request)
        writeJson(res, 200, { ok: true, value })
      } catch (error) {
        const normalized = normalizeError(error, 'WORKBENCH_ERROR')
        const status = clientErrorCode(normalized.code) ? 409 : 500
        writeJson(res, status, errorEnvelope(normalized.code, normalized.message))
      }
    },
  })
}

function validateRequest(value: unknown): WorkbenchRpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw codedError('INVALID_REQUEST', 'Workbench RPC body must be an object')
  const row = value as Record<string, unknown>
  if (typeof row.sessionId !== 'string' || row.sessionId.trim() === '') throw codedError('INVALID_REQUEST', 'sessionId must be a non-empty string')
  if (typeof row.method !== 'string' || row.method.trim() === '') throw codedError('INVALID_REQUEST', 'method must be a non-empty string')
  if (row.args !== undefined && (typeof row.args !== 'object' || row.args === null || Array.isArray(row.args))) {
    throw codedError('INVALID_REQUEST', 'args must be an object when present')
  }
  return {
    sessionId: row.sessionId,
    method: row.method,
    ...(row.args === undefined ? {} : { args: row.args as Record<string, unknown> }),
  }
}


export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const value = address.toLowerCase()
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1'
    || value.startsWith('127.')
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined || origin === 'null') return origin !== 'null'
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) return false
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

function isJson(contentType: string | string[] | undefined): boolean {
  const raw = Array.isArray(contentType) ? contentType[0] : contentType
  return typeof raw === 'string' && raw.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > maxBytes) throw codedError('BODY_TOO_LARGE', `Workbench RPC body exceeds ${maxBytes} bytes`)
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function setCommonHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

function writeJson(res: ServerResponse, status: number, body: WorkbenchHttpEnvelope): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Length', Buffer.byteLength(json))
  res.end(json)
}

function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { ok: false, error: { code, message } }
}

function normalizeError(error: unknown, fallbackCode: string): { code: string; message: string } {
  if (error instanceof Error) {
    const code = typeof (error as Error & { code?: unknown }).code === 'string'
      ? (error as Error & { code: string }).code
      : fallbackCode
    return { code, message: error.message || code }
  }
  return { code: fallbackCode, message: String(error) }
}

function clientErrorCode(code: string): boolean {
  return code.startsWith('INVALID_')
    || code === 'UNKNOWN_METHOD'
    || code === 'SESSION_NOT_LIVE'
    || code === 'SESSION_NO_CWD'
    || code === 'VERSION_CONFLICT'
    || code === 'REVIEW_INCOMPLETE'
    || code === 'CHANGESET_NOT_FOUND'
    || code === 'CHANGESET_NOT_PROPOSED'
    || code === 'HUNK_NOT_FOUND'
    || code === 'BROWSER_TAB_NOT_FOUND'
    || code === 'BROWSER_DOMAIN_DENIED'
    || code === 'BROWSER_SCHEME_DENIED'
    || code === 'SELECTION_ARTIFACT_MISMATCH'
    || code === 'AGENT_TASK_ACTIVE'
    || code === 'AGENT_NO_PROPOSAL'
    || code === 'REMOTE_ACCESS_DENIED'
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
