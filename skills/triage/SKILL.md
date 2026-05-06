# Triage

Systematically process items: inbox, observations, or automation eligibility.

## Focus Modes

Use `/triage <mode>` to focus on a specific area:

| Mode           | Purpose                            | Documentation                                |
| -------------- | ---------------------------------- | -------------------------------------------- |
| `inbox`        | Process inbox items → specs/tasks  | [docs/inbox.md](docs/inbox.md)               |
| `observations` | Process pending observations       | [docs/observations.md](docs/observations.md) |
| `automation`   | Assess task automation eligibility | [docs/automation.md](docs/automation.md)     |

Without a mode, follow the full triage session pattern below.

## Core Concept: Record → Act

Triage uses a **two-step pattern** that separates decision-making from execution:

1. **Record** the decision (what to do + why)
2. **Act** on the decision (execute it)

This separation enables review, override, and audit trails.

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

## Full Session Pattern

1. **Get context**

   ```bash
   kspec session start --full
   kspec inbox list
   kspec meta observations --pending-resolution
   kspec tasks assess automation
   ```

2. **Present overview to user**
   - Inbox items by category
   - Pending observations by type
   - Unassessed tasks needing triage

3. **Ask which focus area**
   - Inbox items
   - Observations
   - Automation eligibility

4. **Process that focus area**
   - Use the relevant sub-document for guidance

5. **Repeat or stop** when user indicates

## Quick Start by Mode

### `/triage inbox`

Process inbox items using the record → act pattern. See [docs/inbox.md](docs/inbox.md).

```bash
kspec inbox list

# Interactive mode: triage all untriaged items one by one
kspec triage start

# Or record decisions individually
kspec triage record @ref --action promote --reasoning "Clear feature need"
kspec triage record @ref --action delete --reasoning "Outdated"
kspec triage record @ref --action defer --reasoning "Not ready yet"
kspec triage record @ref --action spec-gap --reasoning "Missing spec coverage"
kspec triage record @ref --action duplicate --reasoning "Covered by @other-ref"

# Then execute recorded decisions
kspec triage act @triage-ref
kspec triage act @triage-ref --dry-run  # Preview first
```

### `/triage observations`

Process pending observations. See [docs/observations.md](docs/observations.md).

```bash
kspec meta observations --pending-resolution
# For each: resolve, promote to task, or leave
kspec meta resolve @ref "Resolution notes"
kspec meta resolve @ref1 @ref2 "Batch resolution"
kspec meta observations promote @ref --title "..."
```

### `/triage automation`

Assess task automation eligibility. See [docs/automation.md](docs/automation.md).

```bash
kspec tasks assess automation
# Review criteria, fix issues, or mark status
kspec task set @ref --automation eligible
kspec task set @ref --automation needs_review --reason "..."
```

## Triage Commands Reference

### Recording Decisions

```bash
# Record a triage decision for an inbox item
kspec triage record @inbox-ref --action <action> --reasoning "why"
kspec triage record @inbox-ref --action promote --reasoning "..." --evidence @spec-ref
kspec triage record @inbox-ref --action promote --reasoning "..." --json  # JSON output

# Interactive mode: presents untriaged items one at a time
kspec triage start
# Ctrl+C preserves all previously committed records
```

### Reviewing Decisions

```bash
# List all triage records
kspec triage list
kspec triage list --status triaged         # Only pending execution
kspec triage list --status acted_on        # Already executed
kspec triage list --action promote         # Filter by action type

# Get details of a specific record
kspec triage get @triage-ref

# Export for agent handoff
kspec triage export --format context       # Markdown context blocks
kspec triage export --format json          # Full JSON array
```

### Executing and Overriding

```bash
# Execute a recorded decision
kspec triage act @triage-ref
kspec triage act @triage-ref --dry-run     # Preview without executing

# Override a previous decision (preserves audit trail)
kspec triage override @triage-ref --action defer --reasoning "Not ready yet"
# Then act on the updated decision
kspec triage act @triage-ref
```

## Bulk Operations with Batch

When processing many items at once, use `kspec batch`:

```bash
# Record multiple triage decisions atomically
kspec batch --commands '[
  {"command":"triage record","args":{"ref":"@ref1","action":"delete","reasoning":"Stale"}},
  {"command":"triage record","args":{"ref":"@ref2","action":"delete","reasoning":"Duplicate"}},
  {"command":"triage record","args":{"ref":"@ref3","action":"promote","reasoning":"Clear scope"}}
]'
```

Use `--dry-run` to preview. See `{skill:help}` for full batch documentation.

## Key Principles

- **Record before act** - Separate decisions from execution for audit trail
- **Ask one question at a time** - Don't batch decisions
- **Spec before task** - Fill spec gaps before creating tasks
- **AC is required** - Specs without acceptance criteria are incomplete
- **Use CLI, not YAML** - All changes through kspec commands
- **Delete freely** - Outdated items should go

## Progress Tracking

At session end, provide summary:

- Items triaged (recorded decisions)
- Actions executed (promoted, deleted, deferred, spec-gap, duplicate)
- Tasks created/updated
- Observations resolved
- Remaining items
