export interface WorkbenchClientTransport {
  call<T>(sessionId: string, method: string, args?: Record<string, unknown>): Promise<T>
}

interface WorkbenchHttpEnvelope {
  ok: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}

/** Primary transport for an installable out-of-tree DSH package. The endpoint
 * is same-origin and is registered by the Host half through ctx.webServer. */
export class SameOriginHttpTransport implements WorkbenchClientTransport {
  constructor(
    private readonly endpoint = '/api/dsh-workbench/call',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(sessionId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, method, args }),
    })
    let envelope: WorkbenchHttpEnvelope
    try {
      envelope = await response.json() as WorkbenchHttpEnvelope
    } catch {
      throw codedError('TRANSPORT_INVALID_RESPONSE', `Workbench Host returned a non-JSON response (HTTP ${response.status})`)
    }
    if (!response.ok || envelope.ok !== true) {
      throw codedError(envelope.error?.code ?? 'TRANSPORT_ERROR', envelope.error?.message ?? `Workbench Host request failed (HTTP ${response.status})`)
    }
    return envelope.value as T
  }
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
