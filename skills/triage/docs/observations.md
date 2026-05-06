# Observations Triage

Process pending observations: evaluate, resolve, or promote to tasks.

## Workflow

### 1. List Pending Observations

```bash
kspec meta observations --pending-resolution
```

### 2. Process by Type

| Type         | How to Process                                                                         |
| ------------ | -------------------------------------------------------------------------------------- |
| **friction** | Does it reveal a spec gap? → Create spec or inbox item. If already addressed → resolve |
| **success**  | Document in relevant spec or AGENTS.md if broadly useful → resolve                     |
| **question** | Answer it if you can. If needs investigation → promote to task                         |
| **idea**     | Evaluate scope. Clear → inbox or task. Unclear → leave or delete                       |

### 3. Processing Commands

```bash
# Promote observation to task (when actionable work is clear)
kspec meta observations promote @ref --title "Add bulk AC command" --priority 2

# Resolve observation (when addressed or no longer relevant)
kspec meta resolve @ref "Resolution notes"
kspec meta resolve @ref1 @ref2 "Batch resolution"

# Convert inbox item to observation (if it's friction, not a task)
kspec meta observe --from-inbox @ref
```

## When to Use Which

- **Inbox** = future work that becomes tasks
- **Observations** = systemic patterns that inform improvements
- **Tasks** = clear, actionable implementation work

## Decision Flow

```
For each observation:
├─ Still relevant?
│   ├─ No → resolve with note
│   └─ Yes → Does it need action?
│       ├─ No (just learning) → resolve after documenting
│       └─ Yes → Is scope clear?
│           ├─ Yes → promote to task
│           └─ No → add to inbox for later triage
```

## Bulk Resolution with Batch

When resolving many observations at once, use `kspec batch`:

```bash
kspec batch --commands '[
  {"command":"meta resolve","args":{"ref":"@obs1","resolution":"Fixed in PR #100"}},
  {"command":"meta resolve","args":{"ref":"@obs2","resolution":"No longer relevant"}},
  {"command":"meta resolve","args":{"refs":["@obs3","@obs4"],"resolution":"Addressed by new workflow"}}
]'
```

Use `--dry-run` to preview. See `{skill:help}` for full batch documentation.

## Common Patterns

| Pattern                | Action                                                         |
| ---------------------- | -------------------------------------------------------------- |
| Friction already fixed | Verify fix → resolve with note                                 |
| Friction needs work    | Check spec → create if needed → promote or inbox               |
| Success pattern        | Document in AGENTS.md or relevant spec → resolve               |
| Open question          | Answer if possible → resolve. If needs investigation → promote |
| Idea with clear scope  | Promote to task or inbox                                       |
| Vague idea             | Leave or delete if stale                                       |

## Key Principles

- **Observations capture learning** - Not just todos
- **Friction informs improvement** - Turn pain points into better specs
- **Success patterns are worth documenting** - Help future sessions
- **Questions should get answers** - Don't let them linger
