# dsh-workbench

Review-first Artifact and Browser Workbench for DeepSeek Harness (DSH).

> Status: **0.4.0-beta.0 candidate**. The file/web editing control plane, Chromium/CDP Browser Workbench, Agent proposal bridge, hunk review, Apply/Undo, package bundle shape, and local install/uninstall smoke tests are implemented. A real DSH profile + live provider/model run, unrestricted HTTP/HTTPS navigation, visual regression, and a higher-assurance filesystem backend remain release gates.

## What it does

DSH conversation remains the coordination channel; artifacts become explicit work objects:

```text
Artifact + exact versioned Selection + instruction
                 -> Agent
                 -> proposed ChangeSet
                 -> hunk review
                 -> checkpoint + version recheck
                 -> apply -> verify -> undo
```

The important product rule is simple: **the Agent proposes; Workbench applies after review**. During an active Workbench task, direct mutation surfaces are guarded so the model cannot promise a preview while quietly changing the workspace.

## Implemented

### Artifact / file control plane

- versioned Artifact and Selection protocols
- normalized Add / Update / Delete / Move ChangeSets
- SHA-256 content versions
- path traversal and absolute-path rejection
- symlink boundary checks
- atomic writes
- per-patch TOCTOU version recheck immediately before mutation
- rollback only for paths actually modified by the current transaction
- persistent checkpoints with executable-mode preservation
- hunk-level Accept / Reject / Comment / revise
- Apply fails closed while review is incomplete

### Agent bridge

- binds work to the exact live DSH Session/Agent
- workspace root derives only from `agent.session.header.cwd`
- injects exact text or DOM Selection context
- registers a task-scoped `workbench_propose` tool
- denies direct `write`, `edit`, `bash`, `str_replace_editor`, `terminal_open`, and `terminal_send` during review-first work
- Code Mode nested mutation calls are covered by the same guard contract
- proposal boundary revalidates stale selections before accepting a ChangeSet
- webpage/source text is marked as **untrusted data**, escaped, and bounded before entering model context

### Browser Workbench

- real Chromium process lifecycle and CDP connections
- one browser process/profile per DSH Session
- ephemeral browser profiles by default
- tabs, Back / Forward / Reload, screenshot preview
- URL scheme/domain policy; `file:` is denied
- DOM inspection by selector or screenshot point
- interactive element picker using one-time random `Runtime.addBinding` (no wildcard `postMessage`)
- versioned DOM selections; DOM drift returns `VERSION_CONFLICT`
- bounded Console and Network capture
- Annotation Composer -> Agent -> ChangeSet
- Apply -> preview refresh -> visual verification -> Undo Golden flow

### DSH UI / package integration

- header toggle: additive `conversation.session.header.utilities`
- drawer: additive `shell.overlay`
- does **not** replace DSH's single-occupancy `details` slot
- installable DSH **bundle** via `dsh.bundle.patch`
- dynamic Client package metadata via `dsh.client`
- self-registering `lib/client.js` compatible with DSH's `__ModuleLoader__` model
- Host transport uses the official `webServer.register()` route seam
- Workbench HTTP route is hard-locked to loopback clients, requires same-origin JSON POSTs, is request-size bounded, and sends `no-store`

## Install candidate

The package is a DSH bundle, so a real DSH installation should install it into a profile rather than merely `npm install` it:

```bash
dsh plugin --profile workbench-beta add ./dsh-workbench-0.4.0-beta.0.tgz
dsh --profile workbench-beta --dump-config
dsh --profile workbench-beta
```

The dump should contain a `dsh-workbench` bundle layer. Remove it with:

```bash
dsh plugin --profile workbench-beta remove dsh-workbench
```

The current execution environment does not contain a runnable DSH CLI or live provider credentials, so those exact commands remain a release gate rather than a claimed result.

## Development / verification

```bash
npm run check
npm run test:golden
npm run test:package
npm run verify:install
```

Current verified state in this build environment:

- `npm run check`: **21/21 PASS**
- Golden workflows: file and Browser UX PASS
- real local Chromium/CDP tests PASS (using `Page.setDocumentContent` where navigation is blocked by host policy)
- package contract: DSH bundle/client manifest, loader-factory execution, HTTP security, Host lifecycle PASS
- tarball install / Host-entry smoke / lifecycle cleanup / uninstall PASS

The local install verifier uses small fake value peers only to prove the shipped Host entry can load and dispose from the tarball. It is **not** a substitute for a real DSH runtime/model E2E.

## Environment limitation

This execution container has Chromium managed policy `URLBlocklist: ["*"]`. Normal HTTP/HTTPS navigation returns `ERR_BLOCKED_BY_ADMINISTRATOR`. Browser tests therefore validate real Chromium, CDP, DOM selection, screenshot, Console/Network, Apply/refresh/Undo using `about:blank + Page.setDocumentContent`. Unrestricted navigation remains a release gate in a normal environment.

## Security boundary still open

The current workspace implementation performs canonical-path and symlink checks but still uses ordinary Node filesystem path operations. A hostile local process racing parent path components could create a higher-assurance path-TOCTOU problem. Before a security-hardened stable release, mutations should move onto DSH `ctx.fs`/sandbox-policy semantics or an equivalent descriptor/no-follow filesystem backend. See [SECURITY.md](./SECURITY.md).

## Documents

- [Architecture](./ARCHITECTURE.md)
- [DSH contract audit](./DSH_CONTRACT_AUDIT.md)
- [Technical spike / reuse decisions](./TECH_SPIKE.md)
- [Security](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

The package is intentionally called Beta while the real DSH profile/model gate is still open. Version numbers are cheap; corrupted workspaces are not.
