# DSH Contract Audit

Audited against public `deepseek-ai/deepseek-harness` master on 2026-08-22 (current package line observed: `0.1.1-rc.2`). This file records contracts dsh-workbench actually depends on; it is not a claim that a live DSH runtime was available in this build environment.

## Agent contracts

Used contracts from `@deepseek-ai/dsh-agent`:

- `Agent.followup(message)`
- `Agent.inject(message)`
- `Agent.whenIdle()`
- `Agent.ctx` for agent-scoped contributions
- `ctx.agents.get(sessionId)` for resolving the exact live Agent
- `agent.session.header.cwd` as the workspace-root source

The Workbench bridge does not create a second Agent loop.

## Tool contracts

Used contracts from `@deepseek-ai/dsh-tools` / DSH tool pipeline:

- `agent.ctx.tools.register(...)` for task-scoped `workbench_propose`
- `agent.ctx.tools.guard(...)` for a monotonic Agent-local deny boundary
- `defineTool(...)` for the proposal tool
- Code Mode nested subcalls go through the normal registry prepare/policy pipeline before dispatch

During a Workbench review-first task the guard denies:

```text
write
edit
bash
str_replace_editor
terminal_open
terminal_send
```

Reads/search remain available. The proposal tool disappears after the Agent returns idle.

## Why Workbench uses a proposal tool

DSH filesystem `fs/write-intent` / `fs/edit-intent` gates decide policy/freshness but are not a generic content-proposal transport. `tools/pre-execute` is allow/deny/ask and intentionally does not rewrite arbitrary tool arguments. Intercepting every first-party mutation result would couple Workbench to multiple unrelated canonical output contracts.

A dedicated scoped `workbench_propose` therefore makes the human review boundary explicit without changing the DSH loop.

## Client slot contracts

Current DSH client composition shows:

- top-level `details`: single slot, occupied by shipped conversation DetailsPanel;
- `shell.overlay`: additive root list slot;
- `conversation.session.header.utilities`: additive per-session list slot.

Workbench uses only the latter two. It does not shadow the conversation column, sidebar, root, or official details panel.

## Client plugin loading contract

Current DSH dynamic Client packages:

1. declare `dsh.client` in `package.json`;
2. expose `./client`;
3. ship `lib/client.js` that registers a closure factory through `__ModuleLoader__.load({ id, factory })`;
4. are discovered because the Host composition actually mounts the package row.

The dsh-workbench package build emits and executes this loader form in a package contract test. Its runtime Client external set is audited so Node Host modules do not leak into the browser bundle.

## Bundle/install contract

DSH `dsh plugin add` activates **bundle layers**, not arbitrary npm dependencies. A package without `dsh.bundle.patch` installs but contributes no configuration layer.

dsh-workbench therefore declares:

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": [ ... ] }
}
```

and ships `cordis.patch.yml` containing the Host plugin row.

## Client -> Host transport audit

Important distinction:

- `harness.handle` / `host.call` is the package-private channel of **dynamic Cordis Runner closure packages**;
- it is not the general transport for an ordinary out-of-tree npm-installed Client plugin.

Current installable dsh-workbench therefore uses the official Host `webServer.register()` route seam. The route is:

- exact-path;
- POST-only;
- JSON-only;
- bounded by request size;
- same-origin checked;
- hard-locked to loopback socket clients;
- `Cache-Control: no-store`;
- `X-Content-Type-Options: nosniff`.

The transport-neutral router remains separate so a future authenticated Typert/API contribution path can replace HTTP.

## Typert Remote boundary

DSH Remote methods are generated from Host contracts, validated with strict codecs, and explicitly mounted by the Client composition owner. Current public architecture does not provide a generic runtime out-of-tree contribution seam that lets this plugin safely invent a strict Client Remote namespace on installation. Workbench therefore does not fake one.

## Browser contracts

Browser automation is plugin-owned Chromium/CDP, not a DSH core patch. DSH Session identity owns the BrowserSessionRegistry key. Browser auth/profile state is ephemeral by default and separated per Session.

## Verified locally

- DSH-shaped Agent/tool contract simulations
- Code Mode nested mutation guard behavior
- slot target names from current source audit
- self-registering Client bundle contract
- DSH bundle manifest shape
- Host route lifecycle and cleanup
- tarball install/Host-entry smoke/uninstall

## Release gates not claimable in this environment

The container has no runnable DSH CLI/provider credentials and cannot fetch real DSH npm peers because outbound package/DNS access is blocked. Therefore these remain explicit gates:

- `dsh plugin --profile ... add <tarball>` on a real DSH install;
- client Loader activation inside the real DSH web shell;
- live provider/model calling `workbench_propose`;
- native and Code Mode model-backed E2E;
- real HTTP/HTTPS Chromium navigation in an environment without managed URL blocking;
- real DSH upgrade/remove lifecycle.
