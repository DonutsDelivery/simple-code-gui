# Inbox Triage

Process inbox items systematically using the **record → act** pattern: record a decision with reasoning, then execute it.

## Workflow

### 1. Gather Context

```bash
kspec session start --full
kspec inbox list
```

### 2. Categorize Items

Group inbox items by type:

- **Bugs** - implementation issues, errors
- **Spec gaps** - missing or incomplete specs
- **Quick wins** - small, well-defined improvements
- **Larger features** - need plan mode to design
- **Process/workflow** - meta improvements
- **Delete candidates** - outdated, duplicates, already done

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

If a decision needs changing before or after execution:

```bash
# Override changes the action while preserving the audit trail
kspec triage override @triage-ref --action defer --reasoning "Reconsidered - not ready"

# Then act on the updated decision
kspec triage act @triage-ref
```

### 6. Spec-First Processing

For behavior changes, check spec coverage before promoting:

1. **Check coverage**: `kspec item list | grep <relevant>`
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

### 7. Plan Mode for Larger Items

When an item needs design work:

1. Enter plan mode
2. Explore codebase for patterns/context
3. Design spec structure and implementation approach
4. Write plan, exit for approval
5. Execute: create spec, add AC, derive task

## Export for Context

Share triage decisions with other agents or sessions:

```bash
# Markdown context blocks (for agent handoff)
kspec triage export --format context

# Full structured data
kspec triage export --format json
```

## Bulk Processing with Batch

When triaging many items, use `kspec batch` to record decisions in bulk:

```bash
# Record multiple decisions atomically
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

- **Record before act** - Decisions are separated from execution
- **Ask one question at a time** - Use AskUserQuestion for decisions
- **Spec before task** - Fill spec gaps before promoting to tasks
- **AC is required** - Specs without acceptance criteria are incomplete
- **Use CLI, not YAML** - All changes through kspec commands
- **Delete freely** - Outdated or duplicate items should go
