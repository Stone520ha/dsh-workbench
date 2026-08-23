/** DSH infinite-canvas browser plugin entry. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createInfiniteCanvasClientPlugin } from './canvas-client.js'

const plugin = createInfiniteCanvasClientPlugin()

export const inject = ['slots']
export function apply(ctx: ClientContext): void {
  plugin.apply(ctx as never)
}
