# Writing Specs

Create and maintain specification items — the source of truth for what to build. This skill covers spec structure, writing good acceptance criteria, using traits, and organizing specs in the hierarchy.

## When to Use

- Creating a new feature, requirement, or constraint spec
- Adding or refining acceptance criteria
- Applying traits for cross-cutting behaviors
- Organizing specs under the right module/parent
- Reviewing spec quality before deriving tasks

**Not for:** Task management (use `{skill:task-work}`), plan-to-spec translation (use `{skill:plan}`), or triage (use `{skill:triage}`).

## Finding Things

Use CLI commands to discover and inspect specs. **Do NOT search `.kspec/` YAML files manually.**

| Need                 | Command                           |
| -------------------- | --------------------------------- |
| View spec + all ACs  | `kspec item get @ref`             |
| Search by keyword    | `kspec search "keyword"`          |
| List by type         | `kspec item list --type feature`  |
| All modules          | `kspec item list --type module`   |
| All traits           | `kspec trait list`                |
| Trait details + ACs  | `kspec item get @trait-slug`      |
| Items under a parent | `kspec item list --under @parent` |

## Core Principles

1. **Spec defines WHAT, not HOW** — Describe the desired behavior, not the implementation
2. **Every spec needs AC** — A spec without acceptance criteria is incomplete
3. **Given/When/Then is testable** — Each AC should map to at least one test
4. **Traits eliminate duplication** — Cross-cutting concerns belong in traits, not copied across specs
5. **Use CLI, not YAML** — All changes through `kspec` commands for auto-commit

## Spec Hierarchy

Specs live in modules and form a tree:

```
module (organizational grouping)
├── feature (user-facing capability)
│   ├── requirement (specific testable behavior)
│   └── constraint (limitation or boundary)
├── feature
│   └── requirement
└── decision (architectural choice, ADR-style)
```

### Choosing the Right Type

| Type          | Use when                                       | Example                                                        |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| `module`      | Grouping related features                      | "CLI Commands", "Web UI", "Schema"                             |
| `feature`     | User-facing capability                         | "JSON Export", "Inbox Triage", "Shadow Sync"                   |
| `requirement` | Specific testable behavior within a feature    | "Export validates output format", "Triage records audit trail" |
| `constraint`  | Non-functional limit or boundary               | "Response time < 200ms", "Max 1000 items per module"           |
| `decision`    | Architectural choice with rationale            | "Use YAML over JSON for spec files"                            |
| `trait`       | Reusable AC bundle for cross-cutting behaviors | "JSON output mode", "Confirmation prompts"                     |

**Rule of thumb:** If it has acceptance criteria that a user could verify, it's a feature or requirement. If it constrains how something works, it's a constraint. If multiple specs need the same behavior, extract a trait.

## Writing Acceptance Criteria

AC are the heart of a spec. They define what "done" means.

### Format

```
Given: precondition (state before the action)
When:  action (what triggers the behavior)
Then:  outcome (observable, verifiable result)
```

### Good AC Patterns

**Specific and testable:**

```bash
kspec item ac add @json-export \
  --given "user has 3 tasks in project" \
  --when "user runs 'kspec tasks list --json'" \
  --then "stdout contains valid JSON array with 3 task objects"
```

**Covers error cases:**

```bash
kspec item ac add @json-export \
  --given "project has no tasks" \
  --when "user runs 'kspec tasks list --json'" \
  --then "stdout contains empty JSON array []"
```

**Boundary behavior:**

```bash
kspec item ac add @bulk-delete \
  --given "user passes 50 refs (maximum supported)" \
  --when "user runs bulk delete" \
  --then "all 50 items deleted in single operation"
```

### AC Anti-patterns

| Anti-pattern             | Problem            | Better                                              |
| ------------------------ | ------------------ | --------------------------------------------------- |
| "System works correctly" | Not testable       | Describe specific observable outcome                |
| "User is happy"          | Subjective         | Describe what they can do or see                    |
| "Fast performance"       | Not measurable     | "Response returns within 200ms"                     |
| "Handles errors"         | Vague              | Specific error scenario + expected behavior         |
| Duplicating trait AC     | Maintenance burden | Apply the trait instead                             |
| Implementation details   | Not behavioral     | Describe observable outcome, not internal mechanism |
| Rationale or commentary  | Not testable       | Move to description or implementation notes         |

### Behavioral Language Rules

Specs are standalone behavioral contracts. They must read as timeless descriptions of what the system does, not how it's built. A spec should make sense to someone who has never seen the codebase.

**ACs describe observable behavior, not implementation:**
ACs should describe what happens from the outside — what a user or consumer observes. They should not reveal how the system achieves the behavior internally. This includes field/variable names, protocol details, internal function calls, file formats, library names, and architectural terms. Use natural language to describe the same concept.

Examples of implementation leaking into ACs:

- `session_id`, `turn_count` → "session identifier", "turn count"
- `ACP`, `JSON-RPC`, `WebSocket` → describe the behavior these enable
- `client.prompt()`, `closeSession()` → "the prompt is delivered", "the session closes"
- `events.jsonl` → "the session's event history"

**ACs contain only assertions, not rationale:**
Each AC should state what happens, not why it happens or how it relates to other concerns. Rationale, design context, backward compatibility notes, and cross-references to other specs belong in the description or implementation notes — not in the given/when/then.

Examples of commentary leaking into ACs:

- "the session closes; this preserves backward compatibility" → "the session closes"
- "per @other-spec" → use `depends_on` or `relates_to` fields
- "unlike the previous behavior" → just state the current behavior

**Descriptions follow the same principles** — describe behavior and purpose, not implementation approach. Implementation guidance belongs in task descriptions or implementation notes.

**Good:**

```
Given: A session is in idle state
When: No prompt arrives within the configured grace period
Then: The session is closed
```

**Bad:**

```
Given: A session emits session.idle and no session_prompt actions target it within 5 seconds
When: The grace period timer fires
Then: closeSession() is called with the standard teardown sequence; this preserves backward compatibility
```

### AC Naming Convention

AC IDs are auto-generated (`ac-1`, `ac-2`, ...) or can be explicit:

```bash
# Auto-generated
kspec item ac add @feature --given "..." --when "..." --then "..."

# Explicit ID for clarity
kspec item ac add @feature --id ac-json-valid --given "..." --when "..." --then "..."
```

### How Many ACs?

- **Minimum 1** — Every spec needs at least one
- **Typical: 2-5** — Happy path + key error cases
- **If 8+** — Consider splitting the spec into smaller requirements
- **Each AC = one behavior** — Don't combine multiple verifiable outcomes

## Working with Traits

Traits are reusable bundles of acceptance criteria. When a spec implements a trait, it inherits all the trait's ACs.

### When to Use Traits

Apply a trait when a spec needs a standard cross-cutting behavior:

```bash
# Discover available traits
kspec trait list

# View trait details (shows ACs that will be inherited)
kspec trait get @trait-json-output

# Apply trait to spec
kspec item trait add @my-command @trait-json-output

# Apply multiple traits
kspec item trait add @my-command @trait-json-output @trait-dry-run
```

### Common Traits

| Trait                        | When to apply                                |
| ---------------------------- | -------------------------------------------- |
| `@trait-json-output`         | Command produces machine-readable output     |
| `@trait-dry-run`             | Command supports preview before execution    |
| `@trait-confirmation-prompt` | Command is destructive                       |
| `@trait-filterable-list`     | Command lists items with filter options      |
| `@trait-shadow-commit`       | Command modifies `.kspec/` data              |
| `@trait-semantic-exit-codes` | Command exit code carries meaning            |
| `@trait-error-guidance`      | Command gives recovery suggestions on errors |
| `@trait-multi-ref-batch`     | Command accepts multiple references          |
| `@trait-priority-parameter`  | Command accepts priority option              |

### Creating New Traits

If 3+ specs need the same behavior, consider extracting a trait:

```bash
# Create the trait
kspec trait add "Pagination Support" --description "Commands that paginate large result sets" --slug trait-pagination

# Add ACs to the trait
kspec item ac add @trait-pagination --given "result set > page size" --when "command runs" --then "first page shown with pagination indicator"
kspec item ac add @trait-pagination --given "user requests next page" --when "user passes --page 2" --then "second page of results shown"
```

### Trait AC Coverage

When implementing specs with traits, all inherited ACs must be covered by tests:

```javascript
// AC: @trait-json-output ac-1
it('should output valid JSON with --json flag', () => { ... });
```

Run `kspec validate` to check for uncovered trait ACs.

## Creating Specs

### New Feature Under a Module

```bash
# 1. Find the right parent module
kspec item list --type module

# 2. Create the feature
kspec item add --under @cli-module --title "Bulk Operations" --type feature --slug bulk-ops

# 3. Add description
kspec item set @bulk-ops --description "Support batch operations on multiple items in a single command"

# 4. Add acceptance criteria
kspec item ac add @bulk-ops \
  --given "user provides 3 item refs" \
  --when "user runs bulk delete" \
  --then "all 3 items deleted and confirmation shown"

kspec item ac add @bulk-ops \
  --given "one of 3 refs is invalid" \
  --when "user runs bulk delete" \
  --then "error reported for invalid ref, valid refs still processed"

# 5. Apply relevant traits
kspec item trait add @bulk-ops @trait-confirmation-prompt @trait-dry-run

# 6. Validate
kspec validate
```

### Requirement Under a Feature

```bash
kspec item add --under @bulk-ops --title "Ref validation in batch mode" --type requirement --slug bulk-ref-validation
kspec item ac add @bulk-ref-validation \
  --given "batch contains mix of valid and invalid refs" \
  --when "batch executes" \
  --then "report lists each ref with success/failure status"
```

### Updating Existing Specs

```bash
# View current state
kspec item get @feature-slug

# Update description
kspec item set @feature-slug --description "Updated description"

# Add missing AC
kspec item ac add @feature-slug --given "..." --when "..." --then "..."

# Update existing AC
kspec item ac set @feature-slug ac-2 --then "updated expected outcome"

# Mark implementation status
kspec item set @feature-slug --status implemented

# Add relationships
kspec item set @feature-slug --depends-on @other-feature
kspec item set @feature-slug --relates-to @related-item
```

## Spec Quality Checklist

Before deriving a task from a spec, verify:

- [ ] **Description** — Explains what and why (not how)
- [ ] **AC coverage** — At least happy path + primary error case
- [ ] **AC testability** — Each AC maps to a concrete test
- [ ] **Traits applied** — Cross-cutting behaviors use traits, not duplicated AC
- [ ] **Correct parent** — Placed under the right module/feature
- [ ] **No implementation details** — AC describes behavior, not code structure
- [ ] **Validation passes** — `kspec validate` reports no errors for this item

## Validation

```bash
# Full validation
kspec validate

# Completeness check
kspec validate --completeness

# Spec-task alignment
kspec validate --alignment

# Strict mode (warnings → errors)
kspec validate --strict
```

**Exit codes:** `0` = success, `4` = errors, `6` = warnings only.

Validation catches:

- Missing acceptance criteria
- Broken references (`@slug` pointing to nonexistent items)
- Missing descriptions
- Orphaned specs (no linked tasks)
- Uncovered trait ACs

## Command Reference

### Item Management

```bash
kspec item list [--type <type>]        # List items
kspec item get <ref>                   # Get item details with ACs and traits
kspec item add --under <parent> --title "..." --type <type> [--slug <slug>]
kspec item set <ref> --title "..."     # Update fields
kspec item set <ref> --description "..."
kspec item set <ref> --status <status> # implementation status
kspec item set <ref> --depends-on <ref>
kspec item set <ref> --relates-to <ref>
kspec item patch <ref> --data '{...}'  # Complex updates
kspec item delete <ref> [--force]
```

### Acceptance Criteria

```bash
kspec item ac list <ref>               # List ACs for item
kspec item ac add <ref> --given "..." --when "..." --then "..."
kspec item ac add <ref> --id <id> --given "..." --when "..." --then "..."
kspec item ac set <ref> <ac-id> --then "updated"
kspec item ac remove <ref> <id> [--force]
```

### Traits

```bash
kspec trait list                       # All traits with AC counts
kspec trait get <ref>                  # Trait details
kspec trait add "Name" --description "..." [--slug <slug>]
kspec item trait add <spec> <trait> [<trait2> ...]
kspec item trait remove <spec> <trait> [<trait2> ...]
```

### Deriving Tasks

Once a spec is ready, derive a task to track implementation:

```bash
kspec derive @feature-slug             # Create task linked to spec
kspec derive @feature-slug --priority 2
```

The derived task gets `spec_ref: @feature-slug` automatically.

## Integration

- **`{skill:plan}`** — Plans create specs via import or manual creation
- **`{skill:task-work}`** — Tasks reference specs; AC guides implementation
- **`{skill:triage}`** — Inbox items may reveal spec gaps
- **`{skill:observe}`** — Friction may indicate missing specs
- **`{skill:review}`** — Reviews check AC coverage
