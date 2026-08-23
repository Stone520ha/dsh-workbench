# DSH Canvas-first upstream patch

The Infinite Canvas MVP is deliberately implemented as an ordinary DSH `conversation.view` contribution. One small DSH core behavior still prevents that contributed view from becoming the default surface: `ConversationSession.tsx` currently hard-codes `chat` whenever the persisted view is `null`.

The patch in this directory changes only the fresh-session default resolution:

- `selectedId === null` -> use the first order-sorted registered view
- stale persisted id -> keep the existing safe fallback to `chat`
- no third-party view installed -> behavior remains unchanged because `chat` is still the first built-in view
- Canvas plugin installed with `order: -10` -> Canvas becomes the default surface

## Verified upstream baseline

- repository: `deepseek-ai/deepseek-harness`
- branch: `master`
- commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- release merge message: `dsh@0.1.1-rc.2`
- target file: `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
- target blob observed while preparing the patch: `c726bcc753672a5b47147023dc951ecdc97b6ee7`

Patch file:

```text
patches/deepseek-harness-canvas-first.patch
```

## Why this is not applied from the plugin

The plugin must not mutate another installed package's source during install or at runtime. Doing that would couple an otherwise clean view contribution to a particular `node_modules` layout and turn upgrades into archaeology.

For the MVP, apply this patch in a DSH source build or a controlled DSH fork. The preferred long-term outcome is an equivalent upstream change that makes the default conversation view extensible.
