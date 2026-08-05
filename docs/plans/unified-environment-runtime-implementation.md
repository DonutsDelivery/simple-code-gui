# Unified Environment Runtime — Executable Implementation Plan

**Status:** Ready — Checkpoint 5 server-authoritative state
**Source roadmap:** `.hermes/plans/2026-08-02_181907-lean-runtime-remote-platform-roadmap.md`
**Source repository:** `/home/user/Programs/Claude Projects/Claude-Terminal`
**Implementation worktree:** `/home/user/Programs/DonutCode-Unified-Runtime`
**Implementation branch:** `feat/donutcode-unified-runtime`
**Implementation base:** `140a21b5853129bd73ccc8994a4d1dfc2baea958`
**Started:** 2026-08-03
**Plan type:** Ordered production checkpoints. Each checkpoint must leave a buildable vertical slice.

## Execution log

- **Checkpoint 0 complete:** isolated worktree `feat/donutcode-unified-runtime` at `/home/user/Programs/DonutCode-Unified-Runtime`, based on `140a21b5853129bd73ccc8994a4d1dfc2baea958`.
- **Checkpoint 1 complete:** replaced positional open-session arguments with named options, fixed explicit fresh-session routing, kept the empty tile viewport mounted and measured, and removed the 1920×1080 bootstrap assumption.
- **Checkpoint 1 verification:** six focused regressions pass; `npm run build` passes. Isolated runtime acceptance later confirmed a fresh no-resume launch (`args: []`, `sessionId: null`) and measured the first tile against the live 920×721 viewport rather than a 1920×1080 fallback.
- **Checkpoint 2 complete:** removed application runtime kspec and Beads/task-panel IPC, preload APIs, mobile routes, installation, instruction injection, adapters, UI, Auto Work loop, caches, and styles. Repository-owned `.kspec`, `.beads`, `kspec.config.yaml`, `kspec-agents.md`, `AGENTS.md`, and external CLI workflows remain ordinary project content. Legacy app-injected Beads instruction blocks are removed by a signature-gated migration without touching repository-owned task-management sections. Nine focused checks and `npm run build` pass; isolated runtime acceptance confirms no Beads API keys, task-panel DOM, or Auto Work controls, and the authenticated former Beads route returns 404.
- **Checkpoint 3A complete:** added schema-v2 harness-field migration with an atomic legacy backup, normalized renderer writes to `harnessId`, introduced Harness types and compatibility aliases, relabeled visible controls, and passed migration/persistence tests plus `npm run build`.
- **Checkpoint 3B naming decision resolved:** the product name is DonutCode. The unrelated domain/GitHub matches are accepted; npm, PyPI, and the exact AUR `donutcode`/`donut-code` package names were unclaimed at verification time. Rebranding may proceed with `donutcode` as the canonical Linux executable/package slug.
- **Checkpoint 3B complete:** renamed desktop/mobile product surfaces and packaging to DonutCode, added idempotent legacy user-data migration, migrated renderer storage keys with compatibility reads, emitted DonutCode pairing payloads while accepting legacy QR/deep links, and updated Linux/package metadata. Thirteen focused rebrand/regression tests pass and `npm run build` passes.
- **Checkpoint 4 complete:** added protocol-version negotiation, stable server identity/platform metadata, explicit capabilities, typed command/event envelopes, authenticated `/api/protocol`, capability-gated renderer listeners and workspace persistence, a complete callable HTTP renderer contract, explicit unsupported-capability errors, and readable incompatible-version rejection. Ten focused protocol/HTTP/QR checks pass, `npm run build` passes, and a freshly synced DonutCode Android debug APK builds successfully with JDK 21.
- **Latest Android debug APK evidence:** `android/app/build/outputs/apk/debug/app-debug.apk`, 28,377,650 bytes, SHA-256 `36c4ebdf4c9d3ff91b4ac2c5c9320651b76236395523b97a9972bf5e4a043cf0`.
- **Checkpoint 4B complete:** replaced the unstructured emoji-only footer with a coherent Voice / Connect / Settings / More action dock and moved voice mode/output, project API, and debug refresh into a labeled overflow. The final implementation has explicit state treatments, one toolbar tab stop, Arrow/Home/End navigation, menu roving focus, Escape/focus restoration, dynamic three/four-column sizing, reduced-motion handling, consistent 18 px icon envelopes, and scroll-bounded viewport-safe portal positioning. Six focused dock checks, `npm run build`, `npm run build:mobile`, Capacitor sync, Android debug assembly, and `git diff --check` pass. Isolated runtime geometry verified equal 48 px primary actions with no sidebar or body overflow at both 280 px and the real 200 px minimum width; the open menu remained entirely contained. Exercising Voice exposed a separate blocked-Whisper-helper CSP defect tracked as `Claude-Terminal-1iw`.
- **Checkpoint 5 complete:** added durable server-owned environment snapshots, revisions, canonical session/PTY records, an ordered bounded event log, atomic receipt/event/snapshot persistence, cross-transport command idempotency, expected-revision conflicts, HTTP/IPC parity, and WebSocket broadcasts. Authoritative event snapshots now drive renderer convergence; reconnect emits an immediate synchronization envelope; cursor gaps use retained events or a full snapshot; renderer caches cannot silently retarget queued stale workspace payloads after a remote revision. The checkpoint suite passes 38/38, the full suite passes 320/320, `npm run build` and `git diff --check` pass. Isolated acceptance used IPC client A plus authenticated HTTP/WebSocket client B: revision 4→5 updated the live DOM and socket, a stale revision-4 write returned 409/current-5, an identical cross-transport retry replayed revision 5 without duplication, and revision 6 restored and converged the server and DOM. Restart preserved authority with no renderer errors; no credential was retained.
- **Isolated runtime acceptance:** launched the worktree build through `scripts/test-env.sh start /tmp/dc-test` with fake `HOME`, dedicated user data and `TMPDIR`, throwaway projects, Electron PID 405355, orchestrator port 19837 alongside the untouched user instance on 19836, and mobile HTTP port 38470. The first live tile exposed a missing `attentionByTabId` prop through an ErrorBoundary; that defect was fixed, covered by regression, rebuilt, and re-tested with no renderer console errors. Authenticated `/api/protocol` returned protocol v1/server v1.3.58 and an unauthenticated request returned 401. The prior expanded PTY run was reproduced as 80/81 with the exact transient-Hermes-ID failure, fixed, then re-run at 81/81. The corrected isolated instance remains running for visual inspection.

## Product contract

Build one application in which Linux, macOS, Windows, Android, iOS, and browser frontends can attach to one or more execution servers and see the same canonical projects, sessions, PTYs, workspace layout, terminal stream, signals, artifacts, and coordination state for each server.

Terminology is fixed:

- **Server/Backend:** the machine/runtime service where files, processes, builds, and harnesses execute.
- **Harness:** Hermes, Claude Code, Codex, Gemini, OpenCode, Aider, Droid, Grok, or Claude-Codex.
- **Session:** one conversation permanently bound to the server and harness that created it.
- **Change Harness:** create a new session using another harness in the same tile. It never converts, migrates, or continues the old session.

A frontend may connect to several servers simultaneously. Every server is authoritative for its own resources. No frontend may independently resume, duplicate, or overwrite a canonical session.

## Explicit non-goals

- Do not migrate a conversation from one harness to another.
- Do not merge two provider-native session histories.
- Do not implement screen streaming or generic remote desktop.
- Do not silently mirror live working directories between machines.
- Do not expose the current mobile server directly to the public Internet.
- Do not build a public relay in the first implementation.
- Do not remove repository-level kspec or Beads use. Remove only runtime application integration.
- Do not use project or track display names as identity.

## Completion model

Each checkpoint below has:

1. exact existing files to modify/delete;
2. proposed new files, explicitly marked **CREATE**;
3. required behavior;
4. focused checks;
5. a stop condition.

Execute in order. Do not open a later checkpoint while an earlier one has an unresolved build, migration, or runtime defect.

---

# Checkpoint 0 — Isolate the implementation from the dirty shared tree

## Purpose

The starting tree contains extensive unrelated modifications in PTY, session, workspace, renderer, preload, kspec adapter, and agent-signal paths. Preserve them before architecture work.

## Actions

1. Record the complete starting status and diff statistics:
   - `git status --short --branch`
   - `git diff --stat`
   - `git diff --name-only`
2. Identify the current authoritative base commit with `git rev-parse HEAD`.
3. Create an isolated worktree/branch from the intended complete feature base. Do not assume local `main` is newer or complete merely from branch names.
4. Transfer only coherent prerequisites already intended for this architecture, especially current agent-signal, renderer PTY subscription, workspace persistence, Hermes resume, and tile work.
5. Leave `.beads/issues.jsonl`, `AGENTS.md`, `.claude/CLAUDE.md`, and unrelated generated instructions outside product commits unless their owning workflow explicitly requires them.
6. Record the implementation tuple `(path, branch, base commit)` at the top of this plan when execution starts.

## Stop condition

The implementation worktree has a known base and no unexplained product edits. The shared root remains unchanged by this checkpoint.

---

# Checkpoint 1 — Fix the two current deterministic regressions

These fixes land first so later synchronization work does not preserve known broken behavior.

## 1A. New Hermes tile must not resume an old session

### Existing files

- `src/renderer/components/sidebar/useProjectItemCallbacks.ts`
- `src/renderer/hooks/useProjectHandlers.ts`
- `src/renderer/App/MainApp.tsx`
- `src/renderer/hooks/useProjectHandlers.test.ts`
- `src/renderer/__tests__/MainApp.workspace-lifecycle.test.tsx`

### Implementation

1. Replace the ambiguous positional new-session arguments in the project/session opening callback with one options object:

   ```ts
   interface OpenProjectSessionOptions {
     initialPrompt?: string
     forceNewSession?: boolean
     targetWorkspaceId?: string
     targetTileId?: string
     placement?: 'new-tile' | 'sub-tab' | 'split-left' | 'split-right' | 'split-top' | 'split-bottom'
     serverId?: string
     harnessId?: HarnessId
   }
   ```

2. Update every caller in the listed files. `isNewSession` maps only to `forceNewSession`; it must never occupy `initialPrompt`.
3. In `useProjectHandlers.ts`, bypass discovery when `forceNewSession === true`.
4. Assert that a forced-new Hermes spawn sends no native session ID and no Hermes tmux-resume ID.
5. Keep ordinary reopen/resume behavior unchanged.

### Focused check

- Extend `useProjectHandlers.test.ts` with a project that has an existing Hermes session, then request a new tile and assert one fresh spawn with no discovery/resume identifier.
- Extend `MainApp.workspace-lifecycle.test.tsx` to assert new-tile placement creates a distinct tab/session record.

## 1B. First tile must fill the empty workspace immediately

### Existing files

- `src/renderer/components/tiled/index.tsx`
- `src/renderer/components/tiled/usePanning.ts`
- `src/renderer/components/tiled-layout-utils.ts`
- `src/renderer/styles.css`
- `src/renderer/components/tiled/index.test.tsx`
- `src/renderer/__tests__/tile-tree.test.ts`

### Implementation

1. Keep the tiled viewport mounted when the workspace has zero tiles.
2. Remove the first-layout dependency on the hard-coded `1920 × 1080` fallback.
3. Use the measured tiled content rectangle as the authoritative first tree bounds.
4. If measurement is not ready, defer tree creation to the next layout effect/frame instead of persisting fallback dimensions.
5. Keep canvas-mode geometry independent. Switching to canvas and back must no longer be required to trigger measurement.
6. Do not alter existing split ratios after the first valid measurement.

### Focused check

- Render an empty tiled workspace inside a non-1920×1080 test container.
- Create the first tile and assert its root bounds match the measured viewport.
- Assert toggling canvas does not change the already-correct tiled root geometry.

## Checkpoint command

```bash
npm test -- src/renderer/hooks/useProjectHandlers.test.ts src/renderer/__tests__/MainApp.workspace-lifecycle.test.tsx src/renderer/components/tiled/index.test.tsx src/renderer/__tests__/tile-tree.test.ts
npm run build
```

## Stop condition

A new Hermes tile always starts fresh, and an empty tiled workspace fills its actual viewport on first creation.

---

# Checkpoint 2 — Remove kspec and Beads from the runtime application

## Preserve unchanged

- `.kspec/`
- `.beads/`
- `kspec.config.yaml`
- `kspec-agents.md`
- `AGENTS.md`
- `.claude/CLAUDE.md`
- external CLI/task workflows

The application treats `.kspec` and `.beads` as ordinary repository directories.

## Delete application-owned integration

- `src/main/ipc/kspec-handlers.ts`
- `src/main/ipc/beads-handlers.ts`
- `src/main/ipc/beads-instructions.ts`
- `src/main/mobile-server/routes/beads.ts`
- `src/preload/handlers/kspec.ts`
- `src/preload/handlers/beads.ts`
- `src/preload/types/beads.ts`
- `src/renderer/api/httpClient/api-beads.ts`
- `src/renderer/components/BeadsPanel.tsx`
- `src/renderer/components/beads/`
- `src/renderer/components/TerminalMenu.tsx`
- `src/renderer/components/terminal/useAutoWork.ts`
- `src/renderer/components/beads/adapters/kspec-adapter.ts`
- `src/renderer/components/beads/adapters/kspec-adapter.test.ts`

## Modify

- `src/main/index.ts`
- `src/main/ipc/index.ts`
- `src/main/app/ipc-handlers/pty.ts`
- `src/main/ipc/voice-handlers.ts`
- `src/preload/index.ts`
- `src/preload/types/api.ts`
- `src/renderer/api/electron-backend.ts`
- `src/renderer/components/sidebar/`
- `src/renderer/components/TerminalBar.tsx`
- `src/renderer/components/terminal/`
- `src/renderer/styles.css`
- `src/main/portable-deps.ts`
- `README.md`

## Implementation

1. Remove all `kspec:*` and Beads IPC registration, preload methods, HTTP/mobile routes, installation, watchers, caches, adapters, task counts, and task-panel UI.
2. Remove application-owned CLI installation, update, init, daemon, dispatch, migration, deletion, and instruction injection for both task systems.
3. Remove the Beads-backed Auto Work loop and its menu/options/marker handling while preserving independent terminal commands such as Summarize Context and Cancel Request.
4. Add a one-way cleanup migration for the exact legacy task-panel instruction signature. Preserve repository-owned task-management sections, `.beads`, `.kspec`, and external CLI use.
5. Remove dead Beads styles, README product claims, rate-limit entries, and portable dependency paths.

## Focused checks

- Assert the cleanup migration removes only blocks containing the legacy `### CLI Commands (beads)` signature and preserves repository-owned task-management sections.
- Assert the task panel and Auto Work controls are absent from the isolated runtime.
- Assert `window.electronAPI` contains no kspec, Beads, or Auto Work property.
- Assert the former authenticated Beads HTTP route returns 404.
- Search `src/` for task-system imports, registration, routes, API methods, and Auto Work markers; expected runtime support references: zero. Migration-only signature references are allowed.

## Checkpoint command

```bash
npm test
npm run build
```

## Stop condition

Kspec and Beads remain usable externally in repositories, but the shipped application does not detect, render, invoke, install, watch, route, or inject either system.

---

# Checkpoint 3 — Correct Harness versus Server terminology with persistence migration

## Existing files

- `src/renderer/api/types.ts`
- `src/main/session-store.ts`
- `src/preload/types/settings.ts`
- `src/preload/types/workspace.ts`
- `src/preload/types/api.ts`
- `src/renderer/stores/workspace.ts`
- `src/renderer/stores/workspace-persistence.ts`
- `src/renderer/api/electron-backend.ts`
- `src/renderer/api/http-backend/http-backend.ts`
- `src/renderer/components/settings/BackendSettings.tsx`
- `src/renderer/components/settings/index.ts`
- `src/renderer/components/settings/settingsTypes.ts`
- `src/renderer/components/sidebar/ProjectSettingsModal.tsx`
- `src/renderer/components/sidebar/ProjectContextMenu.tsx`
- `src/renderer/components/TerminalBar.tsx`
- `src/renderer/components/mobile/MobileTerminalBar.tsx`
- `src/renderer/utils/backendCommands.ts`
- related tests under `src/main/__tests__/session-store.test.ts`, `src/renderer/__tests__/workspace-persistence.test.ts`, `src/renderer/components/SettingsModal.test.tsx`, and `src/renderer/components/TerminalMenu.test.tsx`

## Schema

```ts
export type HarnessId =
  | 'claude'
  | 'gemini'
  | 'codex'
  | 'opencode'
  | 'aider'
  | 'droid'
  | 'hermes'
  | 'grok'
  | 'claude-codex'

export type HarnessSelection = 'default' | HarnessId

export interface ServerIdentity {
  serverId: string
  displayName: string
  platform: 'linux' | 'darwin' | 'win32'
}
```

## Implementation

1. Rename the legacy `BackendId` and `BackendSelection` types to `HarnessId` and `HarnessSelection` wherever they describe agent CLIs.
2. Rename persisted semantic fields:
   - `Settings.backend` → `Settings.defaultHarnessId`
   - `Project.backend` → `Project.harnessId`
   - `OpenTab.backend` → `OpenTab.harnessId`
   - `PtySession.backend` → `PtySession.harnessId`
3. Rename event payloads and callback fields similarly. Do not rename genuine transport classes such as `ElectronBackend` and `HttpBackend`.
4. Add `schemaVersion` to `StoredData` in `session-store.ts`.
5. On load, migrate missing-version/legacy data in memory, preserve a backup, and save the current schema only after successful validation.
6. Read old `backend` fields for one compatibility window; never write them after migration.
7. Relabel user-facing controls:
   - `Backend` when showing Hermes/Claude/etc. → `Harness`
   - `Change Backend` → `Change Harness`
8. Preserve Change Harness behavior: create a new session in the same tile and leave the old session independently resumable.

## Focused checks

- Load a legacy workspace containing settings/project/tab `backend` values and assert lossless `harnessId` migration.
- Round-trip the new schema and assert no semantic `backend` field is written.
- Choose another harness in one tile and assert a distinct session record is created while the old record remains unchanged.

## Checkpoint command

```bash
npm test -- src/main/__tests__/session-store.test.ts src/renderer/__tests__/workspace-persistence.test.ts src/renderer/components/SettingsModal.test.tsx src/renderer/components/TerminalMenu.test.tsx
npm run build
```

## Stop condition

The GUI uses Harness for agent runtime selection. Server/Backend is reserved for execution environments. Existing users retain all settings and sessions.

## 3B. Rebrand the product to DonutCode without losing existing installations

Perform this immediately after the terminology migration and before protocol/version branding becomes public.

### Naming decision

1. The final public product name is **DonutCode**. The name intentionally carries the “do not code” pun and identifies the product as part of the Donut suite.
2. Use `donutcode` as the canonical Linux executable and package slug. The AUR RPC reported no exact `donutcode` or `donut-code` package on 2026-08-03, so reserve and publish under `donutcode` when packaging reaches Checkpoint 14.
3. Complete ordinary trademark and store-identifier due diligence before public release, but do not reopen naming merely because an unrelated GitHub repository or registered domain uses the same generic string.
4. Record final application and bundle identifiers before editing packaging. Do not partially ship mixed names.

### Create

- **CREATE** `src/main/brand-migration.ts`
- **CREATE** `src/main/__tests__/brand-migration.test.ts`

### Existing files

- `package.json`
- `electron-builder.yml`
- `README.md`
- `launch.sh`
- `src/main/app/app-setup.ts`
- `src/main/index.ts`
- `src/main/process-tree.ts`
- `capacitor.config.ts`
- `android/app/build.gradle`
- `android/app/src/main/res/values/strings.xml`
- `ios/App/App/Info.plist`
- `ios/App/App.xcodeproj/project.pbxproj`
- `resources/icon.png`
- `resources/icon.ico`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`

### Canonical visible names

- Product: `DonutCode`
- Headless runtime: `DonutCode Server`
- Desktop executable/service slug: `donutcode`
- Desktop artifact prefix: `DonutCode`
- Mobile display name: `DonutCode`
- AUR package: `donutcode`

### Compatibility implementation

1. Rename visible title, menus, crash metadata, installer names, desktop entries, package descriptions, README copy, and mobile display names.
2. Replace the stale `Claude Terminal` mobile display name and the stale APPX `Simple Claude GUI` display name.
3. Keep an explicit alias table for one compatibility window:
   - prior executable/process names `simple-code-gui` and `simple-claude-gui`;
   - prior user-data locations created by Simple Code GUI and Simple Claude GUI;
   - prior localStorage/Preferences keys beginning `claude-terminal-`;
   - prior deep-link scheme/pairing payload type `claude-terminal`.
4. `brand-migration.ts` must discover legacy data locations, validate them, copy/rename atomically into the DonutCode location, and retain the legacy source until the new copy has loaded and saved successfully.
5. Migrate saved servers, device credentials, workspaces, settings, sessions, and window state without regenerating server identity or invalidating paired devices.
6. Pairing parsers accept the legacy payload type during the compatibility window but emit only the new `donutcode` type.
7. Do not silently change published application IDs. Treat current desktop `com.simple-code-gui.app`, Android `com.claudeterminal.app`, and iOS bundle identity as migration inputs:
   - if no production store identity must be preserved, move once to the final DonutCode IDs before release;
   - if an identity is already published, retain it and change only display/product names unless the store migration is explicitly approved.
8. Update Linux WM_CLASS/process cleanup to recognize both legacy and DonutCode names during migration.
9. Replace visual assets only after final name approval; preserve platform-required dimensions and packaging paths.
10. Add no broad internal symbol churn. `ElectronBackend`, `HttpBackend`, historical migration constants, and compatibility readers retain technically accurate or intentionally legacy names.

### Focused checks

- Start with a legacy Simple Code GUI data directory containing workspaces, server pairings, and harness selections; launch DonutCode and assert all records load unchanged.
- Relaunch and assert migration is idempotent and does not duplicate sessions or servers.
- Parse one legacy pairing payload and assert the next emitted payload uses DonutCode naming.
- Build package metadata and assert user-visible names contain no `Simple Code GUI`, `Simple Claude GUI`, or `Claude Terminal`, except explicit migration/help copy.

### Checkpoint command

```bash
npm test -- src/main/__tests__/brand-migration.test.ts src/main/__tests__/session-store.test.ts
npm run build
```

### Rebrand stop condition

The application is visibly DonutCode on desktop and mobile, existing local data and trusted server relationships survive, and old identifiers remain only in bounded compatibility code.

---

# Checkpoint 4 — Establish a versioned server protocol and repair HTTP parity

This checkpoint does not yet change authority. It makes local and remote transports implement one explicit contract.

## Create

- **CREATE** `src/common/environment-protocol.ts`
- **CREATE** `src/common/environment-capabilities.ts`
- **CREATE** `src/main/__tests__/environment-protocol.test.ts`
- **CREATE** `src/renderer/api/api-contract.test.ts`

## Modify

- `src/renderer/api/types.ts`
- `src/renderer/api/index.ts`
- `src/renderer/api/electron-backend.ts`
- `src/renderer/api/http-backend/http-backend.ts`
- `src/renderer/api/http-backend/workspace-api.ts`
- `src/renderer/api/http-backend/pty-api.ts`
- `src/renderer/api/httpClient/types.ts`
- `src/renderer/hooks/useApiListeners.ts`
- `src/main/mobile-server/index.ts`
- `src/main/mobile-server/routes/index.ts`
- `src/main/mobile-server/routes/workspace.ts`
- `src/main/mobile-server/routes/pty.ts`
- `src/main/mobile-server/websocket-manager.ts`

## Protocol envelope

```ts
interface ProtocolInfo {
  protocolVersion: number
  minimumClientVersion: number
  serverId: string
  serverVersion: string
  platform: 'linux' | 'darwin' | 'win32'
  capabilities: string[]
}

interface CommandEnvelope<T> {
  commandId: string
  clientId: string
  serverId: string
  expectedRevision?: number
  command: T
}

interface EventEnvelope<T> {
  serverId: string
  revision: number
  eventId: string
  occurredAt: number
  event: T
}
```

## Implementation

1. Add `GET /api/protocol` returning `ProtocolInfo`.
2. Classify every `Api` method as:
   - required remote operation;
   - optional capability;
   - client-local desktop operation.
3. Make `HttpBackend` implement every required method. Fix the immediate missing `onOrchestratorSessionCreated` contract before mobile packaging.
4. Remove silent remote no-ops such as discarded `saveWorkspace`; until server-authoritative commands land, return an explicit unsupported-capability error.
5. Add capability checks to UI call sites for optional desktop-only behavior.
6. Keep `/api-server.ts` (the localhost prompt API) separate.
7. Add protocol compatibility rejection with a user-readable upgrade message.

## Focused checks

- Instantiate both Electron and HTTP implementations against the contract test.
- Mount `MainApp` using `HttpBackend` and assert listener registration does not throw.
- Assert an unsupported operation fails explicitly rather than returning false success.

## Checkpoint command

```bash
npm test -- src/renderer/api/api-contract.test.ts src/main/__tests__/environment-protocol.test.ts src/main/__tests__/mobile-server-agent-signals.test.ts
npm run build
```

## Stop condition

The renderer can discover exactly what a server supports, and current-source Android/browser clients no longer crash from API drift.

---

# Checkpoint 4B — Redesign the sidebar bottom action dock

The existing footer exposes microphone, input mode, voice output, project API, debug refresh, mobile pairing, and settings as a flat row of unrelated emoji buttons. It has weak hierarchy, ambiguous state, no resilient narrow-width behavior, and no intentional home for the upcoming Connections manager.

## Existing files

- `src/renderer/components/sidebar/SidebarActions.tsx`
- `src/renderer/components/VoiceControls.tsx`
- `src/renderer/components/sidebar/SidebarContent.tsx`
- `src/renderer/styles.css`
- mobile sidebar/action surfaces

## Create

- **CREATE** `src/renderer/components/sidebar/SidebarActionDock.tsx`
- **CREATE** `src/renderer/components/sidebar/SidebarActionOverflow.tsx`
- **CREATE** focused interaction and responsive-layout tests

## Implementation

1. Replace the raw emoji row with one visually coherent dock using the application's icon system. Do not mix emoji, glyphs, and unrelated icon weights.
2. Keep only primary actions directly visible:
   - contextual voice input with recording/loading/error state;
   - Connections/mobile pairing;
   - Settings.
3. Move secondary controls into one labeled overflow/popover:
   - push-to-talk versus silence detection;
   - voice-output enable/install state;
   - project API start/stop/configure;
   - debug-only refresh.
4. Preserve fast access without forcing users to memorize symbols:
   - tooltip plus accessible label for every icon;
   - visible text labels inside the overflow;
   - explicit active, busy, recording, connected, warning, and error states;
   - no action represented only by color.
5. Make layout size-stable and responsive:
   - consistent minimum hit targets;
   - no overlap, clipping, horizontal scroll, or shrinking icons;
   - at narrow sidebar widths secondary actions remain in overflow rather than disappearing;
   - panels/popovers stay inside the viewport and are dismissible.
6. Implement keyboard behavior with roving focus, Escape dismissal, focus restoration, and focus-visible styling only after keyboard navigation.
7. Reserve the Connections action as the entry point for Checkpoint 8's multi-server manager instead of adding another footer icon later.
8. Use the same information hierarchy on mobile, adapted to touch targets rather than copying desktop geometry.

## Focused checks

- Render every contextual combination: no focused project, API unconfigured/stopped/running, voice unavailable/loading/recording, mobile connected/disconnected, and debug mode.
- Assert all actions have stable accessible names and no icon-only ambiguous state.
- Assert the dock and overflow fit at minimum supported desktop sidebar width and representative mobile width without clipping or horizontal overflow.
- Assert pointer dismissal, Escape dismissal, roving focus, and focus restoration.
- Verify screenshots in the isolated desktop runtime and current Android build at compact and expanded sidebar widths.

## Checkpoint command

```bash
npm test -- src/renderer/components/sidebar/SidebarActionDock.test.tsx
npm run build
```

## Stop condition

The sidebar footer reads as one deliberate action surface, remains usable at every supported width, exposes status without emoji ambiguity, and can accept multi-server Connections without becoming another crowded icon row.

---

# Checkpoint 5 — Make each server authoritative and synchronizable

## Create

- **CREATE** `src/main/environment-state.ts`
- **CREATE** `src/main/environment-command-router.ts`
- **CREATE** `src/main/environment-event-log.ts`
- **CREATE** `src/main/__tests__/environment-state.test.ts`
- **CREATE** `src/main/__tests__/environment-command-router.test.ts`

## Modify

- `src/main/session-store.ts`
- `src/main/pty-manager.ts`
- `src/main/orchestrator-api.ts`
- `src/main/app/ipc-handlers/workspace.ts`
- `src/main/app/ipc-handlers/pty.ts`
- `src/main/mobile-server/routes/workspace.ts`
- `src/main/mobile-server/routes/pty.ts`
- `src/main/mobile-server/websocket-manager.ts`
- `src/renderer/stores/workspace.ts`
- `src/renderer/stores/workspace-persistence.ts`
- `src/renderer/hooks/useWorkspaceLoader.ts`
- `src/renderer/hooks/useProjectHandlers.ts`

## Canonical state

```ts
interface EnvironmentSnapshot {
  serverId: string
  revision: number
  workspace: Workspace
  sessions: CanonicalSession[]
  ptys: CanonicalPty[]
}

interface CanonicalSession {
  agentSessionId: string
  serverId: string
  harnessId: HarnessId
  nativeSessionId?: string
  projectId: string
  ptyId?: string
  lifecycle: 'starting' | 'running' | 'stopped' | 'exited' | 'failed'
}
```

## Implementation

1. Move canonical workspace/session mutation behind `EnvironmentCommandRouter`.
2. Assign each accepted command one monotonically increasing revision and append one event.
3. Persist snapshot plus last revision atomically through `SessionStore`.
4. Maintain a bounded event log sufficient for reconnect catch-up; when the cursor is too old, return a fresh snapshot.
5. Add HTTP endpoints:
   - `GET /api/environment/snapshot`
   - `GET /api/environment/events?after=<revision>`
   - `POST /api/environment/commands`
6. Broadcast every accepted event on the main WebSocket.
7. Deduplicate retried commands by `(clientId, commandId)` and return the original result.
8. Reject stale destructive commands with revision conflict metadata rather than last-writer-wins overwrite.
9. Convert renderer persistence to a cache of the last server snapshot. It cannot push stale workspace JSON over a newer server revision.
10. Keep only physical-device presentation state local: window bounds, reduced motion, and optional local viewport visibility.

## Required commands

At minimum implement typed commands for:

- create/rename/delete workspace;
- create/close/move/focus tile;
- create/attach/stop session;
- start new session with selected harness in an existing tile;
- update project metadata;
- set active workspace/session.

## Focused checks

1. Two simulated clients fetch revision N.
2. Client A creates a tile; both receive revision N+1.
3. Client B retries the same command ID; no duplicate tile appears.
4. A stale client reconnects at N and receives the missing event or a full snapshot.
5. A stale save cannot overwrite N+1.

## Checkpoint command

```bash
npm test -- src/main/__tests__/environment-state.test.ts src/main/__tests__/environment-command-router.test.ts src/main/__tests__/session-store.test.ts src/renderer/__tests__/workspace-persistence.test.ts
npm run build
```

## Stop condition

Two clients connected to one server converge on one revisioned workspace/session state without frontend-owned forks.

---

# Checkpoint 6 — Enforce one runtime per canonical agent session

## Create

- **CREATE** `src/main/session-runtime-registry.ts`
- **CREATE** `src/main/__tests__/session-runtime-registry.test.ts`

## Modify

- `src/main/pty-manager.ts`
- `src/main/app/ipc-handlers/pty.ts`
- `src/main/mobile-server/routes/pty.ts`
- `src/main/mobile-server/websocket-manager.ts`
- `src/main/session-discovery.ts`
- `src/renderer/api/http-backend/pty-api.ts`
- `src/renderer/hooks/useProjectHandlers.ts`
- `src/renderer/components/terminal/useTerminalSetup/eventHandlers.ts`
- `src/renderer/components/terminal/useTerminalSetup/inputHandlers.ts`
- `src/renderer/components/terminal/useTerminalSetup/terminalInit.ts`
- `src/renderer/components/terminal/useTerminalSetup/types.ts`
- `src/renderer/components/terminal/useTerminalSetup/useTerminalSetup.ts`

## Implementation

1. Key runtime ownership by `agentSessionId`, not renderer tab ID.
2. Expose `ensureRuntime(agentSessionId)` with a single-flight start/resume promise.
3. If three clients attach to a stopped session concurrently, execute exactly one native resume and return the same `ptyId` to all three.
4. Keep PTY input ordered through the host. Assign client input sequence/acknowledgement IDs.
5. Keep terminal replay bytes host-owned. Late clients receive one snapshot/replay boundary followed by ordered live bytes without overlap.
6. A frontend disconnect must detach its subscription only. It must not stop the host runtime.
7. Change Harness creates a new canonical session and runtime; it does not change the old session record.
8. Scope resize policy explicitly. One canonical PTY size is host-owned; clients render/scale locally rather than racing resize commands.

## Focused checks

- Three concurrent attach requests yield one harness process and one PTY.
- Input from two clients is serialized and observed in the same order by both subscribers.
- Disconnect/reconnect restores output without duplicate or missing replay boundary bytes.
- Change Harness produces a new session/PTY and preserves the old native session ID.

## Checkpoint command

```bash
npm test -- src/main/__tests__/session-runtime-registry.test.ts src/main/__tests__/pty-manager.test.ts src/main/__tests__/renderer-pty-subscriptions.test.ts src/main/__tests__/renderer-pty-data-pump.test.ts
npm run build
```

## Stop condition

No supported client action can create two live processes for one canonical agent session.

## Completion evidence — 2026-08-03

- Implemented one server-owned `SessionRuntimeRegistry`, keyed by stable `agentSessionId`, with distinct runtime-generation and PTY identities.
- Desktop IPC and authenticated HTTP/mobile claims share the same single-flight creation promise and return the same runtime.
- Persisted tabs now retain `agentSessionId` independently of changing PTY and native harness session IDs.
- Input writes receive per-runtime monotonic acknowledgements; replay sends one sequenced snapshot followed by non-duplicated live output.
- Frontend detach leaves the host runtime alive. Explicit stop waits for observed OS-process exit before allowing reconnect/resume, preventing old/new process overlap.
- Quick failed-resume retries preserve additive runtime/data/exit listeners.
- Legacy `/api/terminal/*`, the localhost orchestrator API, API prompt delivery, WebSocket input/resize, desktop IPC, and `/api/pty/*` now all route process creation and user input through the same runtime authority; source audit found no direct production `ptyManager.spawn()` outside the registry.
- Public environment clients cannot forge `attach-session` or `stop-session`; those lifecycle transitions require an internal registry capability.
- Canonical sessions reject rebinding to a different native harness conversation, and exit cleanup verifies both captured `runtimeId` and `ptyId` generations.
- Focused CP6 suite: 80/80 passed. Full suite: 333/333 passed. Production build and `git diff --check` passed.
- Isolated `/tmp/dc-test` acceptance on orchestrator port 19837 proved:
  - simultaneous IPC claims produced one PTY/process;
  - simultaneous IPC + HTTP claims returned one `ptyId` and `runtimeId`;
  - IPC/HTTP input ordering reached sequence 3;
  - WebSocket reconnect delivered one replay snapshot and one live chunk with no duplicate;
  - detach/reconnect retained the same runtime;
  - restart persisted the canonical session as stopped, then concurrent IPC/HTTP reconnect produced exactly one replacement;
  - explicit stop raced with two reconnects produced one replacement only, with the old PTY absent;
  - legacy mobile create coalesced with an IPC-owned canonical runtime and returned the same `ptyId`/`runtimeId`;
  - orchestrator create/close appeared in canonical authority and transitioned from running to stopped with no live PTY left;
  - a forged HTTP `stop-session` returned 400 while the target runtime remained running;
  - Linux process-tree inspection showed exactly one `/bin/bash --noprofile --norc -i` harness process;
  - renderer console had no errors and no ErrorBoundary was present.

---

# Checkpoint 7 — Extract a headless server runtime and make local Electron use it

## Create

- **CREATE** `src/main/environment-runtime.ts`
- **CREATE** `src/main/headless-server.ts`
- **CREATE** `src/main/server-cli.ts`
- **CREATE** `src/main/__tests__/headless-server.test.ts`
- **CREATE** `scripts/install-server-service.mjs`

## Modify

- `src/main/index.ts`
- `src/main/mobile-server.ts`
- `src/main/mobile-server/index.ts`
- `src/main/app/ipc-handlers/servers.ts`
- `package.json`
- packaging resources/configuration used by Electron Builder

## Implementation

1. Move construction of `PtyManager`, `SessionStore`, protocol server, event state, device registry, files, Git operations, and orchestration into `EnvironmentRuntime`.
2. Electron becomes a launcher/client of a local `EnvironmentRuntime`; window lifecycle cannot own the runtime lifecycle.
3. Rename product-facing “Mobile Server” to “Server” or “Environment Server.” Internal path renaming may wait until imports are stable, but no new code should call it mobile-only.
4. Add CLI:

   ```text
   donutcode-server serve --data-dir <path> --listen <host> --port <port>
   donutcode-server status --data-dir <path>
   donutcode-server stop --data-dir <path>
   ```

5. Write an atomic runtime-info file containing PID, server ID, protocol endpoint, version, and startup nonce. Do not put durable credentials there.
6. Add graceful shutdown and stale PID/socket recovery.
7. Provide Linux user-systemd installation first. Keep Windows service/launch agent work in the platform checkpoint.
8. Electron local mode connects through the same HTTP/WebSocket contract as remote clients. Retain IPC only for client-local window/dialog/keychain operations.

## Focused checks

- Start the server with no BrowserWindow and create/attach a PTY through the protocol.
- Close an Electron window and assert the externally managed server and harness session remain alive.
- Reopen Electron and catch up from the same server revision.

## Checkpoint command

```bash
npm test -- src/main/__tests__/headless-server.test.ts src/main/__tests__/environment-command-router.test.ts
npm run build
```

## Stop condition

The frontend is optional. Host sessions, builds, transfers, and synchronization continue with every GUI closed.

## Completion evidence (2026-08-03)

- `EnvironmentRuntime` now owns persistence, revisioned environment authority, event history, PTYs, canonical runtime arbitration, and the HTTP/WebSocket server. Electron constructs that boundary instead of independently constructing those owners.
- Server persistence, TLS, identity, token, device, logging, meta-project, and portable-dependency paths no longer require Electron's `app` object, so the same runtime starts under ordinary Node with no `BrowserWindow`.
- The built `donutcode-server` CLI supports `serve`, `status`, and `stop`; an isolated foreground run published an atomic `runtime-info.json`, passed `/health`, reported live status, and exited cleanly on CLI stop.
- Runtime-info contains PID, stable server ID, endpoint, version, startup nonce, and start time but no credential. Live-owner validation checks PID plus the endpoint's server ID/startup nonce, preventing stale-file and PID-reuse confusion.
- `scripts/install-server-service.mjs` generated a valid isolated Linux user-systemd unit targeting the built server CLI without modifying the user's real service state.
- Electron local mode now initializes `HttpBackend` against the loopback server and uses the same HTTP/WebSocket domain contract as browser/mobile clients. IPC remains available for desktop-local operations.
- The server always starts on loopback; enabling mobile access rebinds the same authoritative runtime for LAN access rather than creating another authority owner.
- Closing the isolated Electron window left server ID `0784348015740ef5977f95f7d3484b38` and canonical runtime `12a28ab9-5d12-4320-9514-a6b74cdd70ee` / PTY `e233c6e2-6ba8-4506-9592-6b8e4bf5a33c` alive. A second launch exited as the contender, reopened the frontend in the original process, and reattached to those exact identities without spawning a replacement.
- Second-instance startup now acquires the single-instance lock before legacy migration. Migration also ignores transient Chromium singleton links, preventing live-instance migration races and dangling-link failures.
- Isolated renderer acceptance showed `HttpBackend` at `http://127.0.0.1:38470`, a restored workspace, connected PTY WebSocket, and no ErrorBoundary.
- Final gates: 55/55 test files and 336/336 tests passed; production build passed; `git diff --check` passed.

---

# Checkpoint 8 — Add multi-server connection management to every frontend

## Create

- **CREATE** `src/renderer/api/connection-registry.ts`
- **CREATE** `src/renderer/stores/connections.ts`
- **CREATE** `src/renderer/components/Connections/ConnectionsManager.tsx`
- **CREATE** `src/renderer/components/Connections/ServerCard.tsx`
- **CREATE** `src/renderer/components/Connections/AddServerDialog.tsx`
- **CREATE** `src/renderer/components/Connections/ConnectionsManager.test.tsx`

## Modify

- `src/renderer/App/AppConnection.tsx`
- `src/renderer/App/MainApp.tsx`
- `src/renderer/api/index.ts`
- `src/renderer/api/types.ts`
- `src/renderer/components/ConnectionScreen/ConnectionScreen.tsx`
- `src/renderer/components/ConnectionScreen/index.ts`
- `src/renderer/components/ConnectionScreen/storage.ts`
- `src/renderer/components/ConnectionScreen/styles.ts`
- `src/renderer/components/ConnectionScreen/types.ts`
- `src/renderer/components/ConnectionScreen/views/WelcomeView.tsx`
- `src/renderer/components/ConnectionScreen/views/ManualEntryView.tsx`
- `src/renderer/components/ConnectionScreen/views/ConnectingView.tsx`
- `src/renderer/components/ConnectionScreen/views/ErrorView.tsx`
- `src/renderer/components/settings/index.ts`
- `src/renderer/stores/workspace.ts`
- `src/renderer/hooks/useApiListeners.ts`
- `src/renderer/hooks/useProjectHandlers.ts`
- tab/tile components that currently derive operations from one global API instance

## Client model

```ts
interface SavedServerConnection {
  serverId: string
  displayName: string
  endpoints: ConnectionEndpoint[]
  credentialRef: string
  lastSeenProtocolVersion: number
  capabilities: string[]
}

interface ConnectionRegistry {
  get(serverId: string): Api
  connect(serverId: string): Promise<void>
  disconnect(serverId: string): Promise<void>
  subscribe(serverId: string, listener: ConnectionListener): Unsubscribe
}
```

## Implementation

1. Replace the singleton `apiInstance` assumption with a registry keyed by immutable `serverId`.
2. Every project, session, PTY, tile reference, command, and subscription carries `serverId`.
3. Permit one workspace layout to contain sessions from several servers.
4. Show server and harness separately on session/tab details.
5. Add a cross-platform Connections manager with:
   - online/offline state;
   - OS, version, capabilities, latency;
   - endpoint in use;
   - reconnect, rename, remove, revoke;
   - trusted devices;
   - open project/session on this server.
6. New-session flow has separate Server and Harness selectors.
7. Change Harness keeps the current server by default but may create the new session on another explicitly selected server. It still creates a new session in the same tile.
8. A disconnected server leaves its canonical cached state visible/read-only and does not affect tabs owned by other servers.

## Completed handoff (2026-08-04)

- CP8 is complete. Checkpoint 9 may build on the immutable server registry without redesigning the CP5/CP6/CP7 ownership layers.
- Implemented and tested:
  - `ConnectionRegistry` keyed strictly by immutable `serverId`, with endpoint failover, identity validation, independent disconnect, and no fallback lookup;
  - durable structural saved-connection metadata in `src/renderer/stores/connections.ts` without credential values;
  - explicit renderer API lookup by `serverId`;
  - `serverId` ownership on renderer projects and tabs;
  - Canvas/Tiles terminal API selection from each tab's `serverId`;
  - new-session routing with separate explicit `serverId` and `harnessId` while preserving the original session.
- Verified at handoff: 58/58 test files and 345/345 tests passed, production build passed, and `git diff --check` passed.
- Subsequent CP8 routing increment:
  - partitioned environment revision cursors, save queues, invalidation epochs, snapshots, and command identity checks by `serverId`;
  - authoritative workspace application now replaces only one server partition and preserves sibling-server projects, categories, sessions, active layout, and cached attention state;
  - renderer workspace/session/category IDs now use server-scoped composite keys while server persistence converts back to authority-local IDs;
  - workspace serialization sends only the selected server's projects, categories, tabs, sessions, and active session;
  - focused multi-server queue/revision/identity tests and full **58/58 files, 347/347 tests** pass.
  - renderer tab IDs, tile trees, Canvas scenes, attention state, and PTY signal lookup are now scoped by server while persistence maps them back to authority-local IDs;
  - PTY termination routes the authority `ptyId` to the tab's immutable server rather than sending the composite renderer ID;
  - collision-hardening focused tests and the full **58/58 files, 347/347 tests** pass; production build and diff checks pass.
- Final CP8 integration and acceptance:
  - `AppConnection` adopts negotiated APIs into the immutable registry and each connection loads/subscribes to its own authority projection;
  - the Connections manager displays stable identity, endpoint, status, latency, platform, version, capabilities, reconnect, disconnect, rename, and remove controls;
  - project session controls expose immutable origin plus explicit Server and Harness selection; launch creates a new session and preserves the old one;
  - renderer voice/PTTY writes no longer bypass immutable server ownership through `window.electronAPI`;
  - two real isolated headless servers published distinct stable identities; stopping server A preserved server B; restarting A from the same data directory retained A's identity on a new endpoint;
  - full **58/58 files, 348/348 tests**, production build, and diff checks pass.
- Beads source of truth: `Claude-Terminal-fb6` (`Checkpoint 8: add multi-server connection management`) is complete.

## Focused checks

- Connect two fake servers and open one session from each in the same workspace.
- Disconnect one server; the other remains interactive.
- Send a command from each tile and assert routing to its immutable server ID.
- Change Harness in a tile and assert one new session on the selected server with the old session preserved.

## Stop condition

Desktop and mobile frontends can manage and display multiple simultaneous server connections without a global-current-server routing fallback.

---

# Checkpoint 9 — Replace QR-only onboarding with secure multi-method pairing

## Create

- **CREATE** `src/common/pairing-protocol.ts`
- **CREATE** `src/main/mobile-server/routes/auth.ts`
- **CREATE** `src/renderer/components/Connections/PairServerDialog.tsx`
- **CREATE** `src/main/__tests__/pairing-protocol.test.ts`

## Modify

- `src/main/mobile-server/index.ts`
- `src/main/mobile-server/device-registry.ts`
- `src/main/mobile-server/token-manager.ts`
- `src/main/mobile-server/websocket-manager.ts`
- `src/main/mobile-server/middleware.ts`
- `src/renderer/components/ConnectionScreen/ConnectionScreen.tsx`
- `src/renderer/components/ConnectionScreen/types.ts`
- `src/renderer/components/ConnectionScreen/storage.ts`
- `src/renderer/components/ConnectionScreen/views/ManualEntryView.tsx`
- `src/renderer/components/ConnectionScreen/views/WelcomeView.tsx`
- `src/renderer/components/mobile/QRScanner.tsx`

## Supported pairing methods

1. QR scan of a short-lived pairing offer.
2. Paste pairing link/offer.
3. Human-entered code protected by a standard PAKE library; do not invent cryptography or treat the code as a bearer token.
4. Approval by an already trusted device with matching fingerprints.
5. SSH-authenticated bootstrap for desktop clients.
6. One-time pairing file with explicit expiry and single-use consumption.

## Security requirements

1. Every pairing offer identifies `serverId`, endpoint hints, TLS certificate fingerprint, expiry, requested scopes, and one-time nonce.
2. The user sees the server/device fingerprint and scopes before approval.
3. Successful pairing issues a unique revocable per-device credential.
4. Store credentials through platform secure storage:
   - macOS Keychain;
   - Windows Credential Manager;
   - Linux Secret Service/keyring;
   - Android Keystore;
   - iOS Keychain.
5. Add `POST /api/auth/websocket-ticket`; WebSockets use short-lived, single-purpose tickets rather than durable query tokens.
6. Remove durable tokens from URLs and browser history.
7. Revocation immediately closes that device’s HTTP sessions and WebSockets.
8. Pairing attempts are rate-limited, audited, and expire quickly.

## Focused checks

- Pair by paste without a camera.
- Pair by human code using the selected audited PAKE package.
- Reject replayed/expired offers and mismatched fingerprints.
- Revoke a device and assert immediate socket closure.
- Assert logs and URLs contain no durable token.

## Stop condition

Desktop users never need a rear camera, and every onboarding method ends with the same verified server identity and revocable per-device credential.

## In-progress acceptance evidence — 2026-08-05

- Signed offers use a persistent Ed25519 Server identity and are verified locally before endpoint hints are used.
- Production Server startup uses HTTPS and publishes its SHA-256 certificate fingerprint; pinned CLI health and pairing-offer generation passed against a live self-signed Server.
- QR/paste and OPAQUE proofs create pending device requests. A credential is issued only after explicit approval in the Server UI; rejection and secret-protected status polling are implemented.
- Replay is rejected across Server restart. Read-only credentials cannot mint PTY tickets, and revocation closes an already-open device WebSocket immediately.
- Electron, Android, and iOS certificate probe/pin paths are implemented. Android `assembleDebug` passes on Java 21; iOS Capacitor sync passes on Linux.
- API 35 Android emulator acceptance proved the current `donutcode://pair/...` deep link resolves into the rendered connection screen, verifies the signed offer through the guarded pure-JS Ed25519 fallback required by the target WebView, reaches host approval, stores the issued device credential through native secure storage, and renders the connected workspace UI.
- The retired browser redirect path no longer accepts `?token=` credentials; current production source contains no URL-query token import path. Legacy local-storage credentials are deleted after successful migration into secure storage.
- Android native trust acceptance independently proved expected-pin HTTPS `200`, replacement-certificate HTTPS rejection, authenticated ticketed WSS connection, and replacement-certificate WSS rejection with no Server upgrade. A separate API 35 Google Play emulator installed the downloadable barcode module and opened Google's native DonutCode scanner surface successfully; decoding a physical QR target remains a device/manual acceptance row.
- Native iOS compilation on Apple silicon passed at `c1a182f` with the secure-storage and ServerTrust integrations linked, but Google ML Kit forced the Simulator product to x86_64. Simulator acceptance now uses an explicit pod-install/build mode that omits only the device-camera ML Kit pod; runtime launch, deep-link, HTTPS/WSS pinning, and secure-storage evidence require a fresh Mac rerun. Legacy Preferences migration no longer logs or temporarily copies a durable credential before moving it into secure storage.
- The corrected Apple-silicon Simulator artifact at `b6233b0` built universal x86_64/arm64, installed, launched, and rendered the connection UI. URL-scheme routing reached the iOS confirmation boundary; in-app handling and end-to-end HTTPS/WSS remain outstanding. The cross-runtime Ed25519 test now falls back only for unsupported algorithms or incompatible WebCrypto buffer adapters, and both current and legacy direct-host deep links reject query-string credentials without logging the URL.
- At `c6f68af`, the Mac focused gate passed 8/8 and a real signed offer completed pinned TLS, host approval, and per-device credential issuance. Persistence then failed with Keychain error `-34018` because the acceptance command explicitly disabled Xcode build-time signing and therefore omitted the required application-identifier entitlement. The Simulator rail now uses Xcode's normal build-time local signing; the credential-dependent HTTPS/WSS/revocation rows require a fresh rerun.
- At `beabd8f`, Xcode's normal local signing produced a valid ad-hoc signature and a nonempty intermediate simulated application identifier, but effective `ENTITLEMENTS_ALLOWED=NO` caused the final codesign invocation to omit that generated entitlement. The Simulator acceptance rail now explicitly enables Xcode's generated Simulator entitlements at build time; it does not post-sign or inject credential values.
- At `8841891`, effective `ENTITLEMENTS_ALLOWED=YES` still omitted the generated xcent because the target had no `CODE_SIGN_ENTITLEMENTS` input. The app target now owns an empty declarative entitlements file in Debug and Release, forcing Xcode to merge its generated application identifier and pass the resulting xcent to the original build-time codesign invocation.
- At `0b82fce`, Xcode passed the declared empty `App.app.xcent` to final codesign while keeping the generated application identifier only in `App.app-Simulated.xcent`. The source entitlements now explicitly declare the standard variable-expanded application identifier and default Keychain access group, so device/team prefixes remain Xcode-supplied rather than hard-coded.
- Full test gate: 60 files and 357 tests passed. Production build, Android Capacitor sync/build, production dependency audit, and `git diff --check` passed.

The checkpoint remains **in progress**. Android emulator verification now covers signed-offer onboarding, secure storage, connected UI, independent HTTPS/WSS pin behavior, and Play-enabled native scanner startup; decoding a physical QR target remains a device/manual row. The iOS code still needs an Xcode build and simulator/device HTTPS/WSS runtime pass. Isolated Electron runtime acceptance proved that the expected self-signed certificate succeeds and a replacement certificate at the same endpoint is rejected.

---

# Checkpoint 10 — Add repository identity and exact source materialization across servers

## Create

- **CREATE** `src/main/repository-registry.ts`
- **CREATE** `src/main/repository-transfer.ts`
- **CREATE** `src/main/mobile-server/routes/repositories.ts`
- **CREATE** `src/main/__tests__/repository-registry.test.ts`

## Modify

- `src/main/mobile-server/routes/index.ts`
- `src/common/environment-protocol.ts`
- `src/renderer/components/Connections/ConnectionsManager.tsx`
- project/sidebar UI that displays repository location

## Model

```ts
interface RepositoryIdentity {
  repositoryId: string
  normalizedRemotes: string[]
}

interface CheckoutIdentity {
  checkoutId: string
  repositoryId: string
  serverId: string
  absolutePath: string
  commit: string
  tree: string
  branch?: string
  dirty: boolean
}
```

## Implementation

1. Derive repository identity from normalized verified Git remotes/object identity plus a disambiguator when necessary. Never use directory/project display name alone.
2. Report host-native checkout paths and filesystem/platform traits.
3. Implement `materialize revision on server` using clone/fetch/checkout into a server-owned location.
4. Use immutable commit/tree identity as the normal source handoff.
5. Support explicit Git bundle transfer when hosts cannot reach a common remote.
6. For uncommitted work, require an explicit patch/archive manifest and destination conflict preview. Never silently copy a live `.git` directory or working tree.
7. Return a materialization receipt with source server, destination server, commit, tree, path, and dirty state.

## Focused checks

Materialize one revision on Linux, macOS, and Windows fixtures and assert the same tree hash with different native paths.

## Stop condition

Agents on different servers can prove they are building the same source bytes.

---

# Checkpoint 11 — Add content-addressed artifacts and host-to-host transfer

## Create

- **CREATE** `src/main/artifact-store.ts`
- **CREATE** `src/main/artifact-transfer.ts`
- **CREATE** `src/main/mobile-server/routes/artifacts.ts`
- **CREATE** `src/renderer/components/Artifacts/ArtifactPanel.tsx`
- **CREATE** `src/main/__tests__/artifact-store.test.ts`

## Artifact manifest

```ts
interface ArtifactManifest {
  artifactId: string
  sha256: string
  size: number
  filename: string
  mediaType: string
  producerServerId: string
  repositoryId?: string
  commit?: string
  tree?: string
  dirtyPatchId?: string
  platform: string
  architecture: string
  buildCommand?: string
  kind: 'source' | 'package' | 'log' | 'screenshot' | 'test-report' | 'cache'
  createdAt: number
  expiresAt?: number
}
```

## Implementation

1. Store immutable artifact bytes by SHA-256.
2. Publish/list/inspect/download/expire through scoped authenticated routes.
3. Transfer directly server-to-server with resumable chunks and destination hash verification.
4. The requesting frontend brokers metadata only; it is not required to stay open or relay large bytes.
5. Downloaded executable artifacts are never auto-run.
6. Add quotas, cancellation, retention, and secret/path exclusion rules.
7. Associate build/test logs and receipts with exact source and artifact identities.

## Focused checks

Publish on Linux, transfer to Windows/macOS, interrupt/resume once, and verify identical SHA-256 and receipt metadata.

## Stop condition

Build outputs and evidence can move securely between servers without shared folders or ambiguous filenames.

---

# Checkpoint 12 — Add durable cross-server agent coordination

## Create

- **CREATE** `src/common/coordination-protocol.ts`
- **CREATE** `src/main/coordination-store.ts`
- **CREATE** `src/main/coordination-router.ts`
- **CREATE** `src/main/mobile-server/routes/coordination.ts`
- **CREATE** `src/renderer/components/Coordination/CoordinationPanel.tsx`
- **CREATE** `src/main/__tests__/coordination-router.test.ts`

## Model

```ts
interface AgentAddress {
  serverId: string
  agentSessionId: string
}

interface CoordinationMessage {
  messageId: string
  assignmentId: string
  correlationId?: string
  sequence: number
  sender: AgentAddress
  recipient: AgentAddress
  kind: 'request' | 'ack' | 'progress' | 'result' | 'cancel'
  repositoryRevision?: string
  artifactIds?: string[]
  payload: unknown
}
```

## Implementation

1. Persist messages/assignments server-side. Never use frontend-only state or terminal-output scraping.
2. Address exact server/session pairs. Never route by title, project name, recency, or active tile.
3. Deduplicate message IDs and preserve per-assignment ordering.
4. Deliver through a direct authenticated server link in the first version. Use Tailscale or SSH forwarding for reachability.
5. Allow an existing worker agent session to receive an assignment through the harness’s normal supported input channel.
6. Publish machine-readable progress, build/test receipts, logs, and artifact references.
7. Keep work active with every frontend closed.
8. Do not merge worker sessions or represent messages as harness migration.

## Focused check

A Linux coordinator assigns one exact tree to an existing macOS build session and a Windows test session. Both acknowledge once, materialize the tree, return platform-specific receipts and artifacts, and every connected frontend displays the same assignment state.

## Stop condition

Linux, Windows, and macOS agents coordinate durable work without sharing a native conversation or depending on an open GUI.

---

# Checkpoint 13 — Bring Android/APK to supported-client parity

## Fix before packaging

- `HttpBackend.onOrchestratorSessionCreated` and all required API parity from Checkpoint 4.
- Multi-server registry and secure credential storage from Checkpoints 8–9.

## Existing files

- `package.json`
- `capacitor.config.ts`
- `android/app/build.gradle`
- `android/app/capacitor.build.gradle`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/network_security_config.xml`
- `android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java`
- `android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java`
- `.github/workflows/release.yml`

## Implementation

1. Align Capacitor CLI/runtime/platform major versions.
2. Add deterministic scripts:
   - `mobile:sync`: build current renderer then `cap sync`;
   - `android:debug`: clean, sync, `assembleDebug`;
   - `android:release`: clean, sync, `bundleRelease`/`assembleRelease` with external signing inputs.
3. Derive Android version name/code from the product version through one script.
4. Replace template Android tests and wrong package assertion with one launch/connection smoke test.
5. Store paired device credentials in Android Keystore, not localStorage or plain Capacitor Preferences.
6. Exercise foreground/background/reconnect, server switching, workspace catch-up, PTY attach/input, Change Harness, file/artifact download, revocation, and protocol mismatch.
7. Add CI artifact hashing and source commit provenance. Never distribute a debug-signed APK as release output.
8. Add AAB/APK release artifacts without embedding signing secrets in the repository.

## Stop condition

A clean checkout can produce a current, source-attributed, release-signed Android client that connects to multiple servers and observes the same canonical state as desktop clients.

---

# Checkpoint 14 — Add native service packaging and iOS client parity

## Desktop server packaging

1. Linux: user-systemd service, CLI installer, and AUR package under the canonical `donutcode` name.
2. macOS: signed/notarized server helper plus LaunchAgent option.
3. Windows: background server/service lifecycle with explicit user ownership and logs.
4. All platforms expose the same protocol/capabilities and maintain stable server identity across upgrades.

## iOS

1. Reuse the Capacitor frontend, connection registry, pairing protocol, and HTTP/WebSocket contract.
2. Store credentials in iOS Keychain.
3. Add background/reconnect handling consistent with platform limits.
4. Do not attempt local PTY/harness execution on iOS.
5. Add the same Connections, Server, Harness, session, artifact, and coordination UI as Android.

## Stop condition

Windows, macOS, Linux, Android, and iOS frontends use the same server contract, terminology, and canonical state semantics.

---

# Final integrated acceptance

Run this only after all checkpoints are individually closed.

## Topology

- Linux server running Hermes session and coordinator.
- macOS server running a Claude Code build worker.
- Windows server running a Codex test/package worker.
- Linux Electron frontend.
- Mac Electron frontend.
- Android client.
- iOS client when available.

## Scenario

1. Pair every frontend without requiring a camera on desktop.
2. Connect each frontend to all three servers.
3. Open the same Linux Hermes session on all frontends.
4. Assert one Linux harness process, one canonical agent session, one ordered terminal stream, and one workspace revision.
5. Send input from different frontends and assert identical ordered output everywhere.
6. Create/move/close tiles from different clients and assert all clients converge.
7. Change Harness in one tile to Claude Code on macOS; assert a new macOS session is created and the old Linux Hermes session remains independently resumable.
8. Have Linux coordinate macOS and Windows work against one immutable Git tree.
9. Publish native build/test artifacts and receipts; verify source tree and SHA-256 provenance.
10. Close every frontend while work continues, then reconnect and catch up without duplicated sessions or stale overwrite.
11. Revoke one device and assert immediate loss of access without interrupting other devices.

## Final commands

```bash
npm test
npm run build
npm run android:debug
```

Run platform-native package commands only on their native hosts and record `(serverId, OS, source commit, artifact path, artifact hash)`.

## Definition of done

- The product is visibly branded DonutCode, and legacy Simple Code GUI/Claude Terminal data and pairing records migrate without loss.
- Runtime kspec integration is absent; external repository kspec remains intact.
- Backend/Server and Harness terminology are unambiguous in data and UI.
- Sessions are immutable to their creating server/harness.
- Change Harness creates a new session in the same tile.
- One server is the sole authority for all of its sessions, PTYs, files, workspace state, events, artifacts, and assignments.
- Multiple clients attached to one server cannot fork canonical state or duplicate one agent runtime.
- One frontend can connect to multiple servers concurrently.
- Desktop pairing does not require QR scanning and retains equivalent identity/security guarantees.
- Exact source revisions and content-addressed artifacts move between servers with verifiable provenance.
- Cross-platform agents coordinate durable assignments without merging sessions.
- The server continues operating without any frontend open.
- Android and iOS are remote clients of the same protocol, not separate product implementations.
