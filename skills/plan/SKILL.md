# Plan to Spec Translation

Translate approved plans into specs and tasks. Plans are durable artifacts — they persist in the shadow branch, link to derived work, and provide auditable planning history across sessions.

## When to Use

- After plan mode approval — turning an approved plan into trackable specs and tasks
- Creating specs for new features or multi-spec capabilities
- Translating design documents into the spec hierarchy

**Not for:** Raw ideas (use `kspec inbox add`), single spec creation (use `{skill:writing-specs}`), or triage (use `{skill:triage}`).

## Two Paths

### Import Path (Recommended for 3+ Specs)

Write a structured markdown document, import it as a durable plan record, iterate as needed, then derive specs/tasks when the plan is ready.

```bash
kspec plan import ./plan.md --dry-run                           # Preview plan record
kspec plan import ./plan.md --module @target-module             # Store plan (+ optional module)
kspec plan import ./edited.md --into @plan-ref                  # Re-import edits into existing plan
kspec plan set @plan-ref --status approved                      # Approve when ready
kspec plan derive @plan-ref --module @target-module             # Materialize specs/tasks
```

### Manual Path (1-2 Specs)

Create plan record and specs incrementally via CLI.

```bash
kspec plan add --title "Plan Title" --content "Description" --status approved
kspec item add --under @parent --title "Feature" --type feature --slug slug
kspec item ac add @slug --given "..." --when "..." --then "..."
kspec derive @slug
```

### When to Use Which

| Situation                                | Path              |
| ---------------------------------------- | ----------------- |
| Plan mode just approved, complex feature | Import            |
| Adding a requirement to existing feature | Manual            |
| Multiple related specs with parent/child | Import            |
| Quick bug fix that needs spec coverage   | Manual            |
| Translating design doc with many specs   | Import            |
| Iterating on previously imported plan    | Import (`--into`) |

## Three-Phase Workflow

### Phase 1: Design

Always start here — never skip research.

```bash
kspec workflow start @spec-plan-design
```

1. **Explore** — Read relevant code, understand current state
2. **Clarify** — Identify ambiguities, resolve with user
3. **Design** — Spec structure, AC coverage, trait selection
4. **Review** — Check for completeness and gaps

Design concludes by choosing import or manual path.

### Phase 2: Execute

Run the chosen workflow:

```bash
# Import path
kspec workflow start @spec-plan-import

# Manual path
kspec workflow start @spec-plan-manual
```

Before deriving, ask the user: **should this plan use a shared branch
for task stacking?** If yes, run `kspec plan branch @ref` after approval
and before derive. This is a planning decision — dispatch handles the
rest automatically.

### Phase 3: Validate

After import and derive:

```bash
kspec validate              # Check spec quality
kspec validate --alignment  # Verify spec-task links
```

## Plan Document Format

The import parser extracts specs, tasks, and notes from this markdown structure:

````markdown
# Plan Title

## Specs

```yaml
- title: OAuth Provider Support
  slug: oauth-provider
  type: feature
  parent: "@auth"
  description: Support third-party OAuth providers for authentication
  traits:
    - trait-error-guidance
  acceptance_criteria:
    - id: ac-1
      given: User clicks sign-in with Google
      when: OAuth flow completes successfully
      then: User session is created with provider metadata
    - id: ac-2
      given: OAuth provider returns an error
      when: Error callback is received
      then: User sees descriptive error with retry option
  implementation_notes: |
    Use passport.js for OAuth. Per-spec notes go to this spec's derived task.

- title: Token Refresh
  slug: token-refresh
  type: requirement
  parent: "@oauth-provider"
  acceptance_criteria:
    - id: ac-1
      given: Access token is within 5 minutes of expiry
      when: User makes an API request
      then: Token is silently refreshed before the request proceeds
```

## Tasks

derive_from_specs: true

```yaml
- title: Write migration guide
  slug: migration-guide
  description: |
    Document breaking changes and provide step-by-step upgrade instructions
    for users migrating from v1 to v2.
  priority: 2
  tags:
    - docs
  spec_ref: "@oauth-provider"
  depends_on:
    - "@token-refresh"
```

## Implementation Notes

General architecture notes. Attached to the plan record.
Use passport.js for OAuth, following existing auth patterns.
````

### Section Reference

| Section                   | Content                                           | Notes                                                                                   |
| ------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `## Specs`                | YAML code block — array of spec objects           | **Must** use fenced code block (triple-backtick yaml)                                   |
| `## Tasks`                | `derive_from_specs: true` + optional manual tasks | Manual tasks get `plan_ref`; can optionally set `spec_ref`, `depends_on`, `description` |
| `## Implementation Notes` | Plain text                                        | Attached to plan record; per-spec notes use `implementation_notes` field                |

### Spec Fields

| Field                  | Required | Description                                                             |
| ---------------------- | -------- | ----------------------------------------------------------------------- |
| `title`                | Yes      | Spec title                                                              |
| `slug`                 | No       | Human-friendly ID (auto-generated if omitted)                           |
| `type`                 | No       | `feature`, `requirement`, `constraint`, `decision` (default: `feature`) |
| `parent`               | No       | Parent ref (e.g., `"@parent-slug"`)                                     |
| `description`          | No       | What and why                                                            |
| `acceptance_criteria`  | No       | Array of `{id, given, when, then}`                                      |
| `traits`               | No       | Array of trait slugs (e.g., `trait-json-output`)                        |
| `implementation_notes` | No       | Scoped to this spec's derived task                                      |

### Spec Language Quality

Specs in plan documents must follow the same behavioral language rules as any spec. See `{skill:writing-specs}` for the full rules. Key points:

- **ACs describe observable behavior** — not internal mechanisms. Use natural language a non-developer could follow, not code-level terms.
- **ACs contain only assertions** — no rationale, design commentary, or backward compatibility notes. Those belong in descriptions or `implementation_notes`.
- **Specs are standalone and timeless** — describe what the system does, not how it differs from a previous version. Use spec fields (`depends_on`, `relates_to`) for relationships.
- **Implementation guidance goes in tasks** — task descriptions are the right place for file paths, class names, and technical approach.

### Task Fields

| Field         | Required | Description                                               |
| ------------- | -------- | --------------------------------------------------------- |
| `title`       | Yes      | Task title                                                |
| `slug`        | No       | Human-friendly ID (auto-generated from title if omitted)  |
| `description` | No       | Task context — what to do and why                         |
| `priority`    | No       | 1 (highest) to 5 (lowest), default: 3                     |
| `tags`        | No       | Array of tags (e.g., `docs`, `cli`)                       |
| `spec_ref`    | No       | Link to a spec — local spec slug or existing `@ref`       |
| `depends_on`  | No       | Array of refs — local task/spec slugs or existing `@ref`s |

## Trait Selection

Before writing specs, review available traits:

```bash
kspec trait list
kspec trait get @trait-json-output  # See inherited ACs
```

### Common Trait Applications

| Building...             | Consider these traits                              |
| ----------------------- | -------------------------------------------------- |
| CLI command with output | `@trait-json-output`, `@trait-semantic-exit-codes` |
| Destructive operation   | `@trait-confirmation-prompt`, `@trait-dry-run`     |
| List/search command     | `@trait-filterable-list`, `@trait-json-output`     |
| Shadow branch mutation  | `@trait-shadow-commit`                             |
| User-facing error paths | `@trait-error-guidance`                            |
| Batch operations        | `@trait-multi-ref-batch`                           |
| API endpoint            | `@trait-api-endpoint`, `@trait-localhost-security` |
| WebSocket feature       | `@trait-websocket-protocol`                        |

### Trait Naming in Plan Documents

Use the **full trait slug** — import only auto-prefixes `@`, not `@trait-`:

```yaml
# Wrong — resolves to nonexistent item
traits:
  - json-output

# Correct — full slug
traits:
  - trait-json-output
```

## YAML Pitfalls

Plan documents embed YAML that is parsed as structured data. Common issues:

### Block Scalars for Complex Text

Use `|` (literal block scalar) when AC text contains quotes, colons, or special characters:

```yaml
# Problem — mixed quoting breaks parser
acceptance_criteria:
  - id: ac-1
    when: "kspec foo" is run

# Solution — block scalar preserves content literally
acceptance_criteria:
  - id: ac-1
    when: |
      "kspec foo" is run
```

### Colons in Values

YAML treats `: ` (colon-space) as a key-value separator:

```yaml
# Problem — parsed as nested key
then: output shows time: 10:30

# Solution — quote the value
then: "output shows time: 10:30"
```

### Best Practice

Use block scalars (`|`) for ALL given/when/then text. This avoids every quoting issue:

```yaml
acceptance_criteria:
  - id: ac-1
    given: |
      user has an existing session
    when: |
      user runs "kspec session start"
    then: |
      session context shows: active tasks, recent notes, inbox count
```

## Always Dry-Run First

```bash
kspec plan import ./plan.md --dry-run
```

Import dry-run confirms:

- Title, status, and stored module look right
- The file is readable and the full document will be stored as plan content
- No plan state is changed while previewing

## Post-Import Checklist

After importing, verify the stored plan record:

```bash
# Review plan title/content/status/module
kspec plan get @plan-slug

# Iterate on the document if needed
kspec plan export @plan-slug --output ./plan.md
kspec plan import ./plan.md --into @plan-slug --reason "Refined scope"

# Approve when ready to materialize work
kspec plan set @plan-slug --status approved

# Derive specs/tasks from the stored plan document
kspec plan derive @plan-slug

# Validate the resulting refs and coverage surface
kspec validate
```

If derived tasks are too generic to execute without chat history, add a structured task note immediately after derive:

```bash
kspec task note @task-slug "Execution context:
- Background: why this task exists
- Scope: concrete boundaries for this task
- Files: exact files/areas to touch
- Verification: commands/tests to run"
```

## Plan Lifecycle

```
draft → approved → active → completed
                     ↓
                  rejected
```

- **Import** stores the full document as a plan record and defaults to `draft`
- **Import** may optionally store `module_ref` for later derive
- **Manual** creates plan as `approved`
- **Branch** (optional) — after approval but before derive, ask the user
  whether tasks should target a shared plan branch or the default
  integration branch. If the user wants task stacking:

```bash
kspec plan branch @plan-ref          # Deterministic: plan/<slug>/<short-ref>
kspec plan branch @plan-ref --name feat/custom-name  # Custom name
```

Dispatch automatically targets the plan branch for all derived tasks.
Without a plan branch, tasks target the default integration branch as
usual.

- **Derive** materializes an approved plan into specs and tasks by default, then transitions it to `active`
- Mark completed when all derived work is done:

```bash
kspec plan set @plan --status completed
```

> **Plan branch lifecycle:** When a plan has a branch, all derived tasks
> fork from and merge back into that branch. Task work accumulates on the
> plan branch as tasks are completed. Once all tasks are done and the plan
> is marked completed, the plan branch requires manual merging into the
> project's integration branch (e.g., `git merge --no-ff plan/... into dev`).
> A future `kspec plan merge` command may automate this, but for now it is
> a manual step.

## Programmatic Alternative: Batch

For fully programmatic creation (scripts, agent pipelines):

```bash
kspec batch --commands '[
  {"command":"item add","args":{"under":"@parent","title":"Feature X","type":"feature","slug":"feature-x"}},
  {"command":"item ac add","args":{"ref":"@feature-x","given":"...","when":"...","then":"..."}},
  {"command":"derive","args":{"ref":"@feature-x"}}
]'
```

Atomic — all succeed or all roll back. Use `--dry-run` to preview.

## Command Reference

```bash
# Design phase
kspec workflow start @spec-plan-design

# Import path
kspec plan import <path> [--module @module] --dry-run         # Preview plan record
kspec plan import <path> [--module @module] [--status approved]  # Create stored plan record
kspec plan export <plan-ref> --output ./plan.md
kspec plan import <path> --into <plan-ref> [--reason "..."]  # Re-import edits
kspec plan set <plan-ref> --status approved
kspec plan derive <plan-ref> [--module @module] [--no-tasks]

# Manual path
kspec plan add --title "..." --content "..." --status approved
kspec plan get <ref>
kspec plan set <ref> --status <status>
kspec plan note <ref> "..."
kspec plan list

# Plan branch (opt-in task stacking)
kspec plan branch <ref>                              # Create/resume deterministic branch
kspec plan branch <ref> --name <branch>              # Custom branch name
kspec plan set <ref> --branch <name>                 # Set branch manually
kspec plan set <ref> --branch ""                     # Clear branch (revert to default)

# Validation
kspec validate
kspec validate --completeness
kspec validate --alignment
```

## Integration

- **`{skill:writing-specs}`** — Spec authoring details (types, AC format, traits)
- **`{skill:task-work}`** — After specs are created, work on derived tasks
- **`{skill:triage}`** — Inbox items may trigger plan creation
- **`{skill:observe}`** — Friction during planning becomes observations
