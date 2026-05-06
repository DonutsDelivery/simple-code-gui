# Automation Triage

Assess and prepare tasks for automation eligibility. Goal: make tasks self-contained so they can be automated.

## Philosophy

- **Eligible is the goal** - Manual-only should be the exception
- **Criteria are for visibility** - Help identify what's missing, not auto-approve
- **Fix issues, don't just assess** - Guide toward making tasks automatable

## Eligibility Criteria

A task is ready for automation when:

1. Has `spec_ref` pointing to resolvable spec
2. Spec has acceptance criteria (testable outcomes)
3. Task type is not `spike` (spikes output knowledge, not code)

**Having spec + ACs is necessary but not sufficient** - you must also verify the spec is appropriate and ACs are adequate for the task.

**Task type does not determine automation eligibility.** Any non-spike task can be `automation: eligible` — including design tasks, refactoring tasks, documentation tasks, etc. The `automation` field is the definitive source. Once a task is marked `eligible`, do not second-guess it based on type, title, or description.

## Workflow

### 1. Get Assessment Overview

```bash
# Show unassessed pending tasks with criteria status
kspec tasks assess automation

# See what auto mode would change
kspec tasks assess automation --auto --dry-run
```

### 2. Process Each Task

For each task shown:

**If spike:**

- Mark `manual_only` - spikes are inherently human work
- `kspec task set @ref --automation manual_only --reason "Spike - output is knowledge"`

**If missing spec_ref or no ACs:**

- Ask: "Fix now or mark for later?"
- **Fix now:**
  1. Create or find appropriate spec: `kspec item add --under @parent --title "..."`
  2. Add acceptance criteria: `kspec item ac add @spec --given "..." --when "..." --then "..."`
  3. Link task to spec: `kspec task set @ref --spec-ref @spec`
  4. Re-assess and mark eligible if appropriate
- **Mark for later:**
  - `kspec task set @ref --automation needs_review --reason "Missing spec - needs spec creation"`

**If has spec + ACs:**

- Review for eligibility:
  - Is the spec appropriate for this task?
  - Are the ACs adequate and testable?
  - Does the task have sufficient context?
- If yes: `kspec task set @ref --automation eligible`
- If no: Fix issues or mark `needs_review` with specific reason

### 3. Batch Processing with Auto Mode

For fast triage of obvious cases:

```bash
# Apply auto mode (spikes → manual_only, missing → needs_review)
kspec tasks assess automation --auto

# Then manually review the "review_for_eligible" tasks
kspec tasks ready --unassessed
```

Auto mode is conservative:

- Spikes → `manual_only`
- Missing spec/ACs → `needs_review`
- Has spec + ACs → **NOT auto-marked** (requires review)

## Quick Commands

```bash
# Assessment
kspec tasks assess automation              # Show unassessed with criteria
kspec tasks assess automation @ref         # Single task
kspec tasks assess automation --all        # Include already-assessed
kspec tasks assess automation --auto       # Apply obvious cases
kspec tasks assess automation --dry-run    # Preview changes

# Setting automation status
kspec task set @ref --automation eligible
kspec task set @ref --automation needs_review --reason "Why"
kspec task set @ref --automation manual_only --reason "Why"
kspec task set @ref --no-automation        # Clear to unassessed

# Filtering tasks
kspec tasks ready --unassessed             # Tasks needing assessment
kspec tasks ready --eligible               # Automation-ready tasks
kspec tasks ready --needs-review           # Tasks needing human triage
```

## Assessment Output

```
@task-slug  "Task title"
  spec_ref:     ✓ @feature-slug
  has_acs:      ✓ 3 acceptance criteria
  not_spike:    ✓ type: task
  → review_for_eligible (verify spec/AC adequacy)
```

| Recommendation        | Meaning                       | Auto Mode Action                |
| --------------------- | ----------------------------- | ------------------------------- |
| `review_for_eligible` | Passes criteria, needs review | No change (manual review)       |
| `needs_review`        | Missing spec or ACs           | Sets `needs_review` with reason |
| `manual_only`         | Spike task                    | Sets `manual_only`              |

## Key Principles

- **CLI doesn't auto-mark eligible** - Requires agent/human review
- **Agents CAN mark eligible** - When reviewing based on user instruction
- **Add notes when setting status** - Document the "why"
- **Re-assess after fixes** - After adding spec/ACs, check again
