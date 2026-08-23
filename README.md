# DSH Infinite Canvas MVP

A native infinite-canvas conversation view for DeepSeek Harness (DSH).

The design boundary is intentionally simple:

- **DSH owns the Agent runtime**: Session, Agent Loop, Tools, Skills, MCP, providers and submission semantics.
- **The canvas owns the spatial workspace**: nodes, links, selection, context composition, local artifacts and human interaction.
- There is **no second Agent Loop** and no second browser/HTTP Host runtime in this MVP.

## Architecture

```text
DSH Session / Agent / Tools / Skills / MCP
                    |
                    v
          DSH conversation.view
                    |
                    v
             Infinite Canvas
          (@canvas-harness/*)
            /       |       \
        DSH nodes  Notes    Links
            \       |       /
             selected context
                    |
                    v
          DSH InputActions.submit()
                    |
                    v
                DSH Agent
```

## Implemented in the MVP branch

- native `conversation.view` contribution with id `canvas`
- current DSH Session conversation nodes mirrored onto an infinite canvas
- pan, zoom, select, multi-select and drag through `canvas-harness`
- persistent editable local Note nodes
- Arrow/Link tool for spatial relationships
- full canvas Scene persistence using the canvas-harness codec
- debounced browser persistence so pan/stream updates do not write on every frame
- paged DSH history is preserved instead of deleting nodes absent from the current loaded chat window
- selection context uses canvas-harness `getContext({ selectionOnly: true })`, including selected nodes and links
- selected context is explicitly marked as untrusted data before it reaches the Agent
- a canvas-native Ask Agent input sends through DSH's public `InputActions.setDraft()` + `submit()` path
- Agent replies continue through the existing DSH Session and are mirrored back onto the canvas
- Host entry is intentionally inert: no Chromium, HTTP route, filesystem authority or second Agent runtime
- `canvas-harness` and browser-safe transitive dependencies are bundled into the single DSH client package; React/ReactDOM remain supplied by DSH
- generated third-party license notices are included in the package

## Current user flow

```text
Open a DSH Session
        |
        v
Switch to Canvas
        |
        +--> move / arrange existing conversation nodes
        +--> create and edit Notes
        +--> draw Links between objects
        +--> select one or more objects
                    |
                    v
              Ask Agent
                    |
                    v
         original DSH Agent runs
                    |
                    v
        reply appears in Session
                    |
                    v
       reply becomes a canvas node
```

## Deliberately not implemented yet

The MVP is not pretending to be the finished system.

- Canvas is not yet the default DSH conversation view. Current DSH source hard-codes `chat` as the fallback/default view.
- Image, File, Web, Code and richer Artifact nodes still need DSH-specific context adapters.
- Canvas images are not yet bridged into DSH's draft-image registry, so this branch does not fake visual context support.
- real-time multiplayer / presence / permissions are not connected yet
- shared team Skills and internal knowledge sources are not represented as first-class canvas objects yet
- persistence is browser-local; team/server persistence comes later
- live installation inside a real DSH profile with a real model/provider remains a release gate

## Why canvas-harness

The MVP uses [`@canvas-harness/core`](https://github.com/winlp4ever/canvas-harness) and `@canvas-harness/react` because they provide the pieces this architecture needs without replacing DSH:

- MIT license
- React 18+ support
- infinite canvas and node graph primitives
- custom node extension points
- built-in Scene serialization
- AI scene context generation
- typed operation log
- collaboration-ready presence / SyncAdapter interfaces

The project is also the canvas engine used by Dim0, which makes Dim0 useful as a product/reference implementation while DSH remains the execution Harness here.

## Development checks

```bash
npm install
npm run build
npm run build:package
npm run test:package
npm run verify:install
```

The repository contains a GitHub Actions workflow for the MVP branch. A green workflow and a live DSH profile test are required before this draft PR should be treated as merge-ready.

## Branch and PR

- branch: `feat/infinite-canvas-mvp`
- issue: `#1 MVP：将 DSH 会话视图升级为无限画布`
- draft PR: `#2 MVP: DSH Infinite Canvas conversation surface`

## License

Project code is MIT. Bundled third-party notices are generated into `THIRD_PARTY_NOTICES.txt` during `build:package`.
