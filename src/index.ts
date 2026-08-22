/** dsh-workbench Host plugin entry. The Client half is published separately as
 * ./client and loaded through the package's dsh.client declaration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { WorkbenchHostRuntime, type WorkbenchHostConfig } from './server/host-runtime.js'
import { DshWorkbenchAgentRuntimeAdapter } from './server/dsh-runtime.js'

export const name = 'dsh-workbench'
export const inject = ['agents', 'webServer']
export type Config = WorkbenchHostConfig

export function apply(ctx: Context, config: Config = {}): void {
  const runtime = new WorkbenchHostRuntime(ctx as never, config, new DshWorkbenchAgentRuntimeAdapter())
  runtime.start()
  ctx.effect(() => async () => { await runtime.dispose() }, 'dsh-workbench: host runtime')
}

export { WorkbenchHostRuntime }
export type { WorkbenchHostConfig }
