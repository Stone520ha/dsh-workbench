# Changelog

## 0.4.0-beta.0 - 2026-08-22

### Added

- installable DSH bundle manifest and `cordis.patch.yml`
- DSH self-registering Client bundle contract
- additive `shell.overlay` Browser Workbench and session-header toggle
- versioned text and DOM selections
- Agent `workbench_propose` bridge with review-first mutation guard
- hunk Accept / Reject / Comment / revise
- checkpoint / Apply / Undo workflow
- real Chromium/CDP tabs, screenshot, DOM inspect, Console and Network
- per-Session BrowserSessionRegistry with ephemeral profiles by default
- loopback-only same-origin HTTP transport over DSH `webServer.register()`
- untrusted webpage/source context labeling, escaping, and 32 KiB cap
- package install/Host-entry/lifecycle/uninstall smoke verification

### Fixed

- per-patch TOCTOU recheck before mutation
- rollback no longer restores concurrent changes on paths the transaction never touched
- BrowserTab identity caching so Console/Network buffers survive repeated tab lookup
- Chromium teardown race that could leave an `ENOTEMPTY` profile directory
- Chromium startup race where `DevToolsActivePort` existed before valid port content was written

### Known Beta gates

- live DSH profile + provider/model E2E not yet run in this environment
- normal HTTP/HTTPS Chromium navigation cannot be E2E-tested under the container's managed `URLBlocklist: ["*"]`
- visual regression suite is not yet a release gate
- filesystem backend still has a documented high-assurance path-component race limitation under a hostile local process
