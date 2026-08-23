/**
 * DSH Infinite Canvas Host entry.
 *
 * The MVP deliberately owns no Agent runtime, browser process, filesystem
 * authority, HTTP route, or tool loop. Mounting this package exists only to
 * let DSH discover and load the package's `./client` contribution.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-workbench'
export const inject: readonly string[] = []
export interface Config {}

export function apply(_ctx: Context, _config: Config = {}): void {
  // Intentionally empty. DSH owns the Harness; the browser client owns the
  // spatial presentation layer. Keeping this boundary boring is a feature.
}
