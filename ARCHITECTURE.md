# dsh-workbench Architecture

## Purpose

dsh-workbench is a shared working surface between a user and DSH agents. Conversation coordinates intent; versioned Artifacts and Selections identify the exact work object.

```text
Open Artifact -> select exact target -> instruct Agent
              -> proposed ChangeSet -> validate -> review
              -> checkpoint -> version recheck -> apply
              -> verify -> undo/continue
```

## Core domain

### Artifact

A versioned object that can be displayed, selected, or changed. Current protocol kinds include code, text, web, image, PDF, document, spreadsheet, slides, and binary output.

### ArtifactSelection

A version-bound address into an Artifact. Implemented file/web paths use text ranges and DOM nodes. The protocol also reserves image regions, sheet ranges, slide objects, and PDF regions for later renderers. A stale selection is rejected before proposal acceptance or mutation.

### ChangeSet

A reviewable mutation proposal containing normalized Add / Update / Delete / Move patches. Existing-file mutations carry an exact base version. A ChangeSet is not a write request until the review gate accepts it.

### Checkpoint

A restorable snapshot created before accepted writes. Checkpoint semantics are separate from ChangeSet semantics so a future Git/worktree provider can replace the current snapshot implementation without changing review behavior.

## DSH UI composition

DSH's top-level `details` slot is single-occupancy and is owned by the shipped conversation UI. Replacing it would remove official tool details. Workbench therefore mounts only through additive seats:

- toggle: `conversation.session.header.utilities`
- drawer: `shell.overlay`

The drawer is visually docked but remains a separate plugin surface, so DSH core UI does not need to be forked.

## Session scoping

Every RPC request carries a Session id. The Host resolves the exact live Agent and derives the workspace root only from:

```text
agent.session.header.cwd
```

The Client cannot submit an arbitrary workspace root. Browser sessions, checkpoints, ChangeSets, and workspace services are keyed by DSH Session identity.

## Installable transport boundary

The client never imports Node/filesystem code. The domain API is a transport-neutral `WorkbenchRpcRouter`.

For the current **out-of-tree installable DSH bundle**, the production adapter uses the official Host `webServer.register()` seam and a same-origin relative Client fetch:

```text
Workbench Client
  -> POST /api/dsh-workbench/call
  -> loopback-only + same-origin + JSON + size gate
  -> WorkbenchRpcRouter
  -> live Agent/Session scope
```

Why not `host.call`? DSH's `harness.handle` / `host.call` package-private channel belongs to the dynamic Cordis Runner dual-half closure-package mechanism. It is not the general transport for ordinary npm-installed Client plugins.

Why not Typert Remote yet? Current DSH Typert Remote contributions are generated from Host packages and explicitly selected by the Client composition owner. An out-of-tree package cannot simply invent a strict Remote namespace at runtime. The router is deliberately transport-neutral so an upstream third-party Remote seam can replace HTTP later without rewriting Workbench UI/domain logic.

The raw HTTP adapter is therefore conservative in Beta: **remote socket clients are always rejected**. There is no configuration switch to bypass this until the route can participate in a DSH authenticated Connection/API trust boundary.

## Agent bridge

```text
Selection + instruction
  -> validate current Selection version
  -> inject bounded, structured context
  -> Agent.followup(user instruction)
  -> task-scoped workbench_propose
  -> revalidate selection at proposal boundary
  -> normalize/version-pin ChangeSet
  -> human hunk review
  -> checkpoint + per-patch recheck
  -> apply
```

While the task is active, an agent-local monotonic guard denies direct mutation through `write`, `edit`, `bash`, `str_replace_editor`, `terminal_open`, and `terminal_send`. Reads/searches remain available. DSH Code Mode nested tool calls re-enter the standard tool pipeline, so nested mutation names meet the same guard.

### Untrusted selection data

Selected webpage/source text is data, not policy. Workbench:

- marks it explicitly as untrusted;
- tells the Agent not to obey instructions/tool requests/role claims found inside it;
- escapes delimiter-significant characters;
- caps injected selection text at 32 KiB;
- asks the Agent to use normal read/search tools when more source context is needed.

## Browser architecture

```text
BrowserSessionRegistry (DSH Session keyed)
  -> BrowserSession
       -> Chromium process
       -> ephemeral profile by default
       -> tab identity cache
       -> CDP connection(s)
       -> domain/scheme policy
       -> screenshot / DOM / Console / Network
```

DOM selection is versioned from a live page snapshot. Interactive picking uses a random, one-time CDP `Runtime.addBinding` and removes it after selection/cancel. Screenshot clicks are normalized to the page's CSS viewport before `elementFromPoint` inspection.

## Filesystem safety model

Current safeguards:

- workspace-relative targets only;
- traversal and absolute target rejection;
- canonical path and symlink escape checks;
- exact content versions;
- review before writes;
- checkpoint before accepted writes;
- version check at preflight and immediately before each patch;
- rollback only already-written transaction paths.

Known boundary: ordinary Node path-based I/O cannot provide descriptor-level immunity to a malicious local process racing parent path components between validation and final I/O. Stable security hardening should move mutations to DSH `ctx.fs`/sandbox policy or an equivalent no-follow descriptor backend.

## Browser Workbench UI

```text
Session header utility
       |
       v
shell.overlay Workbench
  |-- Browser: URL / tabs / back / forward / reload / screenshot
  |-- Selection + Annotation Composer
  |-- Changes: hunk Accept / Reject / Comment / revise / Apply / Undo
  |-- Console
  `-- Network
```

Components own no filesystem authority. They call a Session-bound controller, which calls the transport, which reaches the Host router.

## Provider boundaries for later phases

- Checkpoint provider: snapshot -> Git/worktree
- Browser driver: current Chromium CDP -> replaceable driver
- Artifact renderers: code/text -> image/PDF -> office formats
- Client transport: current local HTTP -> future authenticated DSH Remote/API seam
- Workspace backend: current Node filesystem -> DSH `ctx.fs`/sandbox-aware backend
