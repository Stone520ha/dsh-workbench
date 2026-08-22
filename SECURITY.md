# Security

## Current Beta posture

dsh-workbench can read project files, launch Chromium, present proposed edits, and apply accepted changes. The security model therefore treats the Workbench as a high-authority local development surface, not as a generic remotely exposed web service.

### Network boundary

The installable Host transport registers `/api/dsh-workbench/call` through DSH `webServer.register()` but **rejects every non-loopback socket client**. There is no Beta configuration switch to bypass this restriction.

Requests must also be same-origin, POST, `application/json`, and below the configured body cap. Responses are `no-store` and `nosniff`.

Remote browser access should not be enabled by binding DSH to `0.0.0.0` and weakening this gate. A future remote mode must participate in DSH's authenticated Connection/API trust boundary first.

### Workspace boundary

Implemented protections:

- workspace root comes from the live DSH Agent Session, not Client input;
- relative paths only;
- traversal/absolute-path rejection;
- canonical/symlink boundary checks;
- content-version guards;
- preflight and immediate pre-mutation version checks;
- review required by default;
- checkpoint before accepted writes;
- rollback only for paths actually touched by the transaction.

Known limitation: the current backend ultimately performs ordinary Node path-based filesystem operations. A hostile local process with access to mutate parent directories could race path components between validation and final I/O. A stable security-hardened release should migrate mutation authority to DSH `ctx.fs`/sandbox policy or an equivalent descriptor/openat/no-follow backend.

### Agent mutation boundary

During a Workbench review task, an Agent-local monotonic guard denies direct mutation through the standard file/shell/terminal mutation tools. The Agent must use the scoped `workbench_propose` tool. The proposal does not change files.

The same policy applies to Code Mode nested tool calls because nested calls re-enter the DSH tool pipeline.

### Web prompt-injection boundary

Selected webpage/source text is untrusted. Workbench:

- labels it as untrusted data;
- warns the model not to obey embedded instructions, role claims, tool requests, or policy text;
- escapes delimiter-significant characters;
- caps selection context at 32 KiB;
- requires additional context to come through normal read/search operations.

This reduces context-confusion risk; it does not make arbitrary web content trustworthy.

### Browser isolation

- browser process/profile is keyed per DSH Session;
- profile is ephemeral by default;
- `file:` navigation is denied;
- URL/domain policy is checked before navigation;
- DOM selections are versioned and fail closed after page drift;
- Console/Network buffers are bounded;
- Session A cannot address Session B's tab id through the registry.

## Reporting a vulnerability

Do not publish credentials, private project data, exploit payloads against real users, or live sensitive endpoints in a public issue. Provide a minimal reproduction that demonstrates the boundary failure without unrelated secrets.

High priority classes include workspace escape, silent overwrite, cross-Session browser/cookie leakage, review bypass, remote HTTP access, mutation-guard bypass, and stale-selection overwrite.
