/** dsh-workbench browser plugin entry. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only slot declarations: the workbench uses the additive session-header
// utility and shell.overlay seats owned by the shipped UI packages.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createWorkbenchClientPlugin } from './dsh-client.js'
import { SameOriginHttpTransport } from './transport.js'

const plugin = createWorkbenchClientPlugin(new SameOriginHttpTransport())

export const inject = ['slots']
export function apply(ctx: ClientContext): void {
  plugin.apply(ctx as never)
}
