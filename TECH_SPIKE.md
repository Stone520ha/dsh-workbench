# dsh-workbench Technical Spike

Status: selection complete; decisions below are reflected in the current Beta architecture.

## Decision rule

`Reuse > Adapt > Rewrite`.

Reuse mature contracts/components when the license and runtime boundary fit DSH. Adapt architectures when their implementation is coupled to another host. Rewrite only DSH-specific lifecycle, selection/versioning, review, security, or transport seams.

## Reuse / Adapt / Rewrite matrix

| Source | What was useful | Decision | dsh-workbench use |
| --- | --- | --- | --- |
| DeepSeek Harness | additive slots, Agent scoped context/tools, tool guards, Code Mode pipeline, WebServer, bundle/client loading model | **Reuse contracts** | No core fork; install as DSH bundle/client plugin; bind work to live Session/Agent. |
| bolt.diy (MIT) | FileTree/Preview/Inspector/Diff UX and visual selection pattern | **Adapt heavily** | Browser/selection/review interaction reference. Do not copy wildcard `postMessage('*')` trust. |
| OpenHands Agent Canvas (MIT) | modular browser/files/terminal/conversation surfaces | **Reuse boundaries selectively** | Surface decomposition; do not install a second Agent/session runtime inside DSH. |
| Cline (Apache-2.0) | checkpoints, compare, restore | **Adapt** | patch-level review plus workspace checkpoint/restore semantics. |
| Codex CLI (Apache-2.0) | structured patch concepts, review/sandbox discipline | **Adapt** | normalized ChangeSet/Patch IR and fail-closed mutation boundaries. |
| Claude Code public architecture | permission/hooks/worktree/subagent isolation | **Adapt public mechanisms** | future permission/worktree provider design; no proprietary code copied. |
| Browser Use (MIT) | persistent event-driven BrowserSession + direct CDP operations | **Adapt architecture** | stateful per-Session Chromium/CDP runtime. |
| Continue (Apache-2.0) | explicit context providers/references | **Adapt** | explicit Artifact/Selection references instead of dumping UI state into prompts. |

## DSH-specific findings

### 1. Do not replace `details`

DSH's top-level `details` is a single slot occupied by `ui-conversation`. Workbench uses the additive `shell.overlay` surface and `conversation.session.header.utilities` toggle.

### 2. Installable Client packages have a specific loader contract

Current DSH Client packages declare `dsh.client`, ship a `./client` entry, and provide a self-registering `lib/client.js` closure factory through `__ModuleLoader__`. dsh-workbench packages its Browser half in that form and contract-tests factory execution.

### 3. `host.call` is not the installable-plugin transport

`harness.handle` / `host.call` belongs to the dynamic Cordis Runner dual-half closure-package system. For this out-of-tree npm-installed bundle, the current viable no-core-fork transport is a named Host `webServer.register()` route plus same-origin relative fetch.

The HTTP route is loopback-only in Beta. Typert Remote is not faked: DSH's strict Remote contributions are build-generated and explicitly selected by Client composition.

### 4. DSH plugin installation requires a bundle layer

`dsh plugin add` activates packages that declare `dsh.bundle.patch`. A plain npm dependency is not enough. dsh-workbench therefore ships `cordis.patch.yml` and a bundle manifest in addition to `dsh.client` metadata.

### 5. Workspaces are Session scoped

The Client never supplies a workspace root. The Host resolves the live Agent and uses `agent.session.header.cwd`.

## Current architecture

```text
DSH header utility
      |
      v
shell.overlay Workbench
      |
      v
Session-bound client controller
      |
      v
same-origin loopback-only HTTP transport
      |
      v
WorkbenchRpcRouter
      |
      +-- Session-scoped workspace / checkpoints / ChangeSets
      +-- BrowserSessionRegistry
      `-- Agent Bridge -> workbench_propose
```

## Non-negotiable quality rules

1. No silent overwrite: exact versions and per-patch recheck.
2. No irreversible default write: checkpoint before accepted mutations.
3. No workspace escape: traversal/absolute paths and external symlink targets fail closed.
4. No UI-only success: Golden tasks verify resulting file/DOM state.
5. No core fork: slots/services/events are the integration boundary.
6. No fake DSH success: real profile/model E2E is reported as open until actually run.
7. Web/source text is untrusted data, never an authority channel.
