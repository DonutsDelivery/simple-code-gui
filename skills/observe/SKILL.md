# Observations

Capture and act on systemic patterns — friction, successes, questions, and ideas. Observations are the feedback loop that drives process improvement.

## When to Use

- You hit friction (something harder than it should be)
- You notice a success worth replicating
- A systemic question arises (not session-specific)
- An improvement idea surfaces during work

**Not for:** Session-local questions (use `kspec meta question`), future work items (use `kspec inbox add`), or task-specific notes (use `kspec task note`).

## Observation Types

| Type       | When to use                           | Example                                              |
| ---------- | ------------------------------------- | ---------------------------------------------------- |
| `friction` | Something is harder than it should be | "Bulk updates require too many commands"             |
| `success`  | A pattern that worked well            | "Dry-run before derive prevented duplicate tasks"    |
| `question` | A systemic question about process     | "When should agents use inbox vs tasks?"             |
| `idea`     | An improvement opportunity            | "CLI could suggest next steps after task completion" |

## Capturing Observations

Capture in the moment — don't wait until later. The value is in the raw context.

```bash
# Friction: something was harder than it should be
kspec meta observe friction "Had to run 5 commands to update one spec field"

# Success: a pattern worth remembering
kspec meta observe success "Using --dry-run before derive prevented duplicate tasks"

# Question: systemic, not session-local
kspec meta observe question "When should agents enter plan mode vs just implement?"

# Idea: something that could improve the system
kspec meta observe idea "CLI could suggest next steps after task completion"

# Link to a workflow for context
kspec meta observe friction "Plan import dropped acceptance criteria" --workflow @spec-plan-import
```

## Reviewing Observations

```bash
# All unresolved observations (default)
kspec meta observations

# Only those awaiting resolution
kspec meta observations --pending-resolution

# Filter by type
kspec meta observations --type friction
```

## Acting on Observations

### Promote to Task

When an observation reveals clear, actionable work:

```bash
kspec meta promote @ref --title "Add bulk AC command" --priority 2
```

### Resolve

When addressed, documented, or no longer relevant:

```bash
# Single observation with resolution note
kspec meta resolve @ref "Fixed in PR #123"

# Batch resolve related observations
kspec meta resolve --refs @ref1 @ref2 @ref3 --resolution "All addressed by new workflow"
```

### Convert from Inbox

When an inbox item is really a pattern observation, not future work:

```bash
kspec meta observe --from-inbox @inbox-ref
kspec meta observe --from-inbox @inbox-ref --type friction
```

## Decision Flow

```
When you notice something during work:
├── Is it future work?
│   └── Yes → kspec inbox add "..."
├── Is it about THIS task only?
│   └── Yes → kspec task note @task "..."
└── Is it a systemic pattern?
    └── Yes → kspec meta observe <type> "..."
```

```
For each pending observation:
├── Still relevant?
│   ├── No → resolve with note
│   └── Yes → Needs action?
│       ├── No (just learning) → document and resolve
│       └── Yes → Scope clear?
│           ├── Yes → promote to task
│           └── No → add to inbox for later triage
```

## Where Observations Fit

| What you have             | Where                   | Why                                |
| ------------------------- | ----------------------- | ---------------------------------- |
| Vague idea for future     | `inbox add`             | Low-friction capture, triage later |
| Clear actionable work     | `task add`              | Ready to implement                 |
| Something was hard        | `meta observe friction` | Informs process improvement        |
| Something worked well     | `meta observe success`  | Worth replicating                  |
| Session-local question    | `meta question add`     | Track during current session       |
| Systemic process question | `meta observe question` | Broader than one session           |

## Batch Capture

When capturing multiple observations at once (e.g., during reflection), use `kspec batch`:

```bash
kspec batch --commands '[
  {"command":"meta observe","args":{"type":"friction","content":"Bulk updates require too many commands"}},
  {"command":"meta observe","args":{"type":"success","content":"Dry-run before derive prevented duplicates"}}
]'
```

## Integration

- **`{skill:triage} observations`** — Processes pending observations during triage
- **`{skill:reflect}`** — Creates observations from session learnings
- **`kspec session start`** — Shows pending observation count
