interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface CdpEvent {
  method: string
  params?: unknown
}

/** Minimal CDP transport. It implements only JSON-RPC framing; browser semantics stay above it. */
export class CdpConnection {
  private socket: WebSocket | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Map<string, Set<(params: any) => void>>()

  constructor(private readonly wsUrl: string) {}

  async open(): Promise<void> {
    if (this.socket !== undefined) return
    const socket = new WebSocket(this.wsUrl)
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => { cleanup(); resolve() }
      const onError = (): void => { cleanup(); reject(new Error(`CDP websocket failed: ${this.wsUrl}`)) }
      const cleanup = (): void => {
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
      }
      socket.addEventListener('open', onOpen, { once: true })
      socket.addEventListener('error', onError, { once: true })
    })
    socket.addEventListener('message', event => this.onMessage(event.data))
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) request.reject(new Error('CDP connection closed'))
      this.pending.clear()
    })
  }

  async send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.open()
    const socket = this.socket
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) throw new Error('CDP connection is not open')
    const id = this.nextId++
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
    })
    socket.send(JSON.stringify({ id, method, params }))
    return result
  }

  once<T = any>(method: string, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        dispose()
        reject(new Error(`Timed out waiting for CDP event ${method}`))
      }, timeoutMs)
      const dispose = this.on<T>(method, params => {
        clearTimeout(timeout)
        dispose()
        resolve(params)
      })
    })
  }

  on<T = any>(method: string, listener: (params: T) => void): () => void {
    let bucket = this.listeners.get(method)
    if (bucket === undefined) {
      bucket = new Set()
      this.listeners.set(method, bucket)
    }
    bucket.add(listener as (params: any) => void)
    return () => {
      bucket?.delete(listener as (params: any) => void)
      if (bucket?.size === 0) this.listeners.delete(method)
    }
  }

  close(): void {
    this.socket?.close()
    this.socket = undefined
  }

  private onMessage(data: unknown): void {
    const text = typeof data === 'string' ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data)
    let message: any
    try { message = JSON.parse(text) } catch { return }
    if (typeof message.id === 'number') {
      const request = this.pending.get(message.id)
      if (request === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) request.reject(new Error(`CDP ${message.error.code ?? ''}: ${message.error.message ?? 'unknown error'}`))
      else request.resolve(message.result)
      return
    }
    if (typeof message.method === 'string') {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    }
  }
}
