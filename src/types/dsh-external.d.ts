declare module '@deepseek-ai/cordis' {
  export interface Context {
    agents: import('@deepseek-ai/dsh-agent').AgentRegistry
    webServer: import('@deepseek-ai/dsh-host-webserver').WebServer
    effect(setup: () => void | (() => void) | Promise<() => void>, label?: string): unknown
    on(event: 'agent/disposed', listener: (payload: { agent: import('@deepseek-ai/dsh-agent').Agent }) => void): () => void
  }
}

declare module '@deepseek-ai/dsh-agent' {
  export interface Agent {
    readonly id: string
    readonly session: { header: { cwd?: string } }
    followup(message: unknown): void
    inject(message: unknown): void
    whenIdle(): Promise<void>
    readonly ctx: {
      tools: {
        register(definition: unknown): () => void
        guard(guard: (execution: { name: string }) => string | undefined): () => void
      }
    }
  }
  export interface AgentRegistry {
    get(id: string): Agent | undefined
  }
}

declare module '@deepseek-ai/dsh-host-webserver' {
  import type { IncomingMessage, ServerResponse } from 'node:http'
  export interface WebServer {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolDefinitionShape {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: unknown
      render: (...args: any[]) => unknown
    }
    execute: (...args: any[]) => any
    presentCall?: (...args: any[]) => unknown
  }
  export function defineTool<T extends ToolDefinitionShape>(definition: T): T
}

declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(input: {
    content: Array<{ type: string; text: string }>
    source: Record<string, unknown>
  }): unknown
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export interface ClientContext {
    slots: {
      inject(name: string, setup: () => (() => void) | void): () => void
      register(options: Record<string, unknown>, component: (props: any) => unknown): () => void
    }
    effect(setup: () => (() => void) | void, label?: string): unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-layout/client' {}
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {}

declare module 'react' {
  export type ReactNode = unknown
  export type CSSProperties = Record<string, string | number | undefined>
  export function createElement(type: any, props?: any, ...children: any[]): any
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void]
}
