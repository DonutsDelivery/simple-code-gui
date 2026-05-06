# Inbox Triage

Systematically process inbox items using the **record → act** pattern. Records decisions with audit trail, then executes actions.

## When to Use

- Processing accumulated inbox items
- During a triage session (`kspec workflow start @inbox-triage`)
- When inbox count is growing and needs attention

## Core Concept: Record → Act

Triage separates **decision-making** from **execution**:

1. **Record** the decision (what to do + why)
2. **Act** on the decision (execute it)

This enables review, override, and audit trails.

```bash
# Step 1: Record what you want to do
kspec triage record @inbox-ref --action promote --reasoning "Clear feature request"

# Step 2: Execute the decision
kspec triage act @triage-ref
```

### Actions

| Action      | What `act` does                       |
| ----------- | ------------------------------------- |
| `promote`   | Creates task from inbox item snapshot |
| `delete`    | Deletes the inbox item                |
| `defer`     | Records deferral, no side effect      |
| `spec-gap`  | Creates observation tagged spec-gap   |
| `duplicate` | Deletes the inbox item                |

### Lifecycle

```
record (with action)     override (optional)     act
    → triaged        →       triaged         →  acted_on
```

## Workflow

### 1. Gather Context

```bash
kspec session start --full
kspec inbox list
```

### 2. Categorize Items

Group inbox items by type:

- **Bugs** — implementation issues, errors
- **Spec gaps** — missing or incomplete specs
- **Quick wins** — small, well-defined improvements
- **Larger features** — need plan mode to design
- **Process/workflow** — meta improvements
- **Delete candidates** — outdated, duplicates, already done

Present categories to user for alignment.

### 3. Triage Each Item

**Interactive mode** (recommended for multiple items):

```bash
kspec triage start
# Presents untriaged items one by one
# Prompts for action + reasoning
# Ctrl+C preserves all previously committed records
```

**Individual recording** (for targeted decisions):

```bash
kspec triage record @ref --action promote --reasoning "Clear feature request with spec coverage"
kspec triage record @ref --action delete --reasoning "Already implemented in PR #123"
kspec triage record @ref --action defer --reasoning "Depends on auth system redesign"
kspec triage record @ref --action spec-gap --reasoning "No spec covers error handling for this flow"
kspec triage record @ref --action duplicate --reasoning "Covered by @existing-spec"
```

### 4. Review and Execute Decisions

```bash
# Review what was recorded
kspec triage list --status triaged

# Preview before executing
kspec triage act @triage-ref --dry-run

# Execute decisions
kspec triage act @triage-ref
```

### 5. Override If Needed

```bash
# Override changes the action while preserving the audit trail
kspec triage override @triage-ref --action defer --reasoning "Reconsidered - not ready"

# Then act on the updated decision
kspec triage act @triage-ref
```

## Spec-First Processing

For behavior changes, check spec coverage before promoting:

1. **Check coverage**: `kspec search "<relevant keyword>"` or `kspec item get @ref`
2. **Identify gaps**: Does spec have description AND acceptance criteria?
3. **Update spec**:
   ```bash
   kspec item set @ref --description "..."
   kspec item ac add @ref --given "..." --when "..." --then "..."
   ```
4. **Record and act**:
   ```bash
   kspec triage record @inbox-ref --action promote --reasoning "Spec updated" --evidence @spec-ref
   kspec triage act @triage-ref
   ```

## Plan Mode for Larger Items

When an item needs design work:

1. Enter plan mode
2. Explore codebase for patterns/context
3. Design spec structure and implementation approach
4. Write plan, exit for approval
5. Execute: create spec, add AC, derive task

## Observation Processing

During triage sessions, you may also process pending observations:

```bash
kspec meta observations --pending-resolution
```

For each observation:

| Type         | How to Process                                                              |
| ------------ | --------------------------------------------------------------------------- |
| **friction** | Reveals spec gap? → Create spec or inbox item. Already addressed? → Resolve |
| **success**  | Document in relevant spec or AGENTS.md if broadly useful → Resolve          |
| **question** | Answer if you can. Needs investigation? → Promote to task                   |
| **idea**     | Clear scope? → Inbox or task. Unclear? → Leave or delete if stale           |

```bash
# Promote observation to task
kspec meta promote @ref --title "Add bulk AC command" --priority 2

# Resolve observation
kspec meta resolve @ref "Resolution notes"
kspec meta resolve --refs @ref1 @ref2 --resolution "Batch resolution"

# Convert inbox item to observation (if it's a pattern, not a task)
kspec meta observe --from-inbox @ref
```

## Export for Context

Share triage decisions with other agents or sessions:

```bash
# Markdown context blocks (for agent handoff)
kspec triage export --format context

# Full structured data
kspec triage export --format json
```

## Bulk Operations with Batch

When triaging many items, use `kspec batch` for atomic operations:

```bash
kspec batch --commands '[
  {"command":"triage record","args":{"ref":"@ref1","action":"delete","reasoning":"Stale"}},
  {"command":"triage record","args":{"ref":"@ref2","action":"promote","reasoning":"Clear scope"}}
]'
```

Use `--dry-run` to preview. See `{skill:help}` for full batch documentation.

## Common Patterns

| Pattern               | Action                                                 |
| --------------------- | ------------------------------------------------------ |
| Already implemented   | Verify impl exists → check spec gaps → record delete   |
| Duplicate of existing | Verify original covers scope → record duplicate        |
| Small flag/option     | Update spec + AC → record promote                      |
| New command           | Plan mode → design spec → record promote with evidence |
| Bug report            | Check spec coverage → update spec → record promote     |
| Vague idea            | Record defer, or leave untriaged for later             |
| Missing spec          | Record spec-gap → creates observation for follow-up    |

## Key Principles

- **Record before act** — Separate decisions from execution for audit trail
- **Ask one question at a time** — Don't batch decisions in interactive mode
- **Spec before task** — Fill spec gaps before promoting to tasks
- **AC is required** — Specs without acceptance criteria are incomplete
- **Use CLI, not YAML** — All changes through kspec commands
- **Delete freely** — Outdated or duplicate items should go

## Progress Tracking

At session end, provide summary:

- Items triaged (recorded decisions)
- Actions executed (promoted, deleted, deferred, spec-gap, duplicate)
- Tasks created/updated
- Observations resolved
- Remaining items

## Integration

- **`{skill:reflect}`** — Session reflection may generate inbox items for triage
- **`{skill:observe}`** — Captures systemic patterns found during triage
- **`kspec session start`** — Shows inbox count for triage awareness
