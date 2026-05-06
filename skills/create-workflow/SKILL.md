# Create Workflow

Formalize repeatable patterns into trackable kspec workflows. A meta-workflow for building new workflows with consistent structure.

## When to Use

- Formalizing a repeated process into a trackable workflow
- Converting step-by-step documentation into executable steps
- Adding quality gates that are easy to skip without structure

**Not for:** Running existing workflows (use `kspec workflow start @id`), one-off processes, or tasks that don't repeat.

## Identifying Good Candidates

Look for processes that are:

| Signal                               | Example                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| Step-by-step instructions in docs    | "To release: bump version, tag, push, create release"        |
| Checklists that get skipped          | "Before merge: check CI, resolve threads, verify AC"         |
| Repeated command sequences           | "Start daemon, run tests, check output, stop daemon"         |
| Quality gates with multiple criteria | "Review: AC coverage, test quality, code style, regressions" |

Good sources: AGENTS.md, existing skills, task notes, session reflections.

## Workflow Structure

Every workflow has:

```yaml
id: kebab-case-name
description: What this workflow does
trigger: when-it-starts
mode: interactive # or loop
steps:
  - id: step-1
    type: action # action, check, or decision
    content: What to do in this step
```

### Triggers

| Trigger           | When                        |
| ----------------- | --------------------------- |
| `manual`          | Invoked explicitly          |
| `session-start`   | Beginning of work session   |
| `session-end`     | End of work session         |
| `task-complete`   | After completing a task     |
| `behavior-change` | Before implementing changes |
| `pre-release`     | Before creating a release   |
| `pr-merge`        | Before merging a PR         |

### Step Types

| Type       | Purpose            | Example                         |
| ---------- | ------------------ | ------------------------------- |
| `action`   | Do something       | "Run tests and verify all pass" |
| `check`    | Verify a condition | "All CI checks passing?"        |
| `decision` | Choose a path      | "Import or manual path?"        |

### Modes

- **interactive** — Pauses for user input at each step
- **loop** — Auto-resolves decisions, no user prompts (for automated agents)

Loop mode workflows typically have a `based_on` field referencing the interactive version.

## Creating a Workflow

### Step 1: Design the Steps

Before creating, outline your steps on paper:

1. What's the trigger?
2. What steps are needed?
3. Which are actions vs checks vs decisions?
4. What inputs does each step need?
5. What's the exit criteria?

### Step 2: Create the Workflow

```bash
kspec meta add workflow \
  --id my-workflow \
  --trigger manual \
  --description "Description of what this workflow does" \
  --tag category \
  --steps '[
    {"id":"step-1","type":"action","content":"First action to take"},
    {"id":"step-2","type":"check","content":"Verify the condition"},
    {"id":"step-3","type":"decision","content":"Choose path A or B"}
  ]'
```

### Step 3: Test the Workflow

Run through it end-to-end:

```bash
kspec workflow start @my-workflow
kspec workflow next --notes "Testing step 1"
kspec workflow next --input decision="path-a" --notes "Chose A because..."
# Continue through all steps
kspec workflow show  # Verify inputs and notes captured
```

### Step 4: Consider a Matching Skill

A workflow may benefit from a matching skill when:

| Create a skill when                | Skip the skill when            |
| ---------------------------------- | ------------------------------ |
| Steps need detailed context        | Workflow is self-contained     |
| Multiple sub-documents help        | Context exists elsewhere       |
| Users need a `/command` entrypoint | Workflow is internal/automated |
| Complex decision logic             | Simple sequential steps        |

If creating a skill, write it to `templates/skills/<name>/SKILL.md` and add a manifest entry.

### Step 5: Commit

```bash
# Workflow definition auto-committed to shadow branch by kspec
# Skill files (if created) need manual commit to main branch
git add templates/skills/<name>/SKILL.md
git commit -m "feat: add <name> skill for workflow integration"
```

### Cross-Skill Consistency Check (When Updating Existing Skills)

If your workflow or wording change is cross-cutting, run this quick consistency pass before committing:

1. List related skills/templates that describe the same concept (for example: `codex`, `pr-review`, `local-review`, review templates).
2. Verify each related file is either updated in the same PR or explicitly noted as intentionally unchanged.
3. Add a short checklist in PR notes showing which related files were reviewed.

This prevents partial updates where one skill changes but sibling skills keep outdated guidance.

## Step Design Guidelines

### Action Steps

Clear, specific instructions:

```yaml
- id: run-tests
  type: action
  content: |
    Run the full test suite. Fix any failures before proceeding.
    Verify both unit and integration tests pass.
```

### Check Steps

Binary yes/no verification:

```yaml
- id: ci-passing
  type: check
  content: |
    Verify all CI checks are passing on the current HEAD.
    If not, wait for CI or fix failures.
```

### Decision Steps

Clear options with guidance:

```yaml
- id: choose-path
  type: decision
  content: |
    Choose execution path:
    - Import: 3+ specs, structured document, batch creation
    - Manual: 1-2 specs, incremental, quick additions
```

### Tips

- Keep steps atomic — one action per step
- Include the "why" when it's not obvious
- Decision steps should list all options
- Check steps should describe what to do on failure
- Use `content` for detailed multi-line instructions

## Loop Mode Variants

For automated agents, create a loop variant:

```bash
kspec meta add workflow \
  --id my-workflow-loop \
  --trigger manual \
  --mode loop \
  --based-on @my-workflow \
  --description "Automated variant of my-workflow" \
  --steps '[...]'
```

Loop variants typically:

- Auto-resolve decisions (pick the most common path)
- Skip user confirmation steps
- Add higher confidence thresholds
- Include automated exit conditions

## Workflow Lifecycle

```bash
# Create
kspec meta add workflow --id ... --steps '[...]'

# Run
kspec workflow start @id
kspec workflow next --notes "..."
kspec workflow next --input key=value

# Manage
kspec workflow show        # Check progress
kspec workflow pause       # Pause for later
kspec workflow resume      # Resume paused run

# Update (edit the meta YAML)
kspec meta set workflow @id --steps '[...]'
```

## Regenerate Agent Instructions

After creating a workflow, regenerate agent instructions so the workflow appears in the available workflows list:

```bash
kspec agents generate
```

## Integration

- **`{skill:reflect}`** — Session reflections surface patterns worth formalizing
- **`{skill:observe}`** — Friction observations may reveal missing workflows
- **`kspec agents generate`** — Regenerate after creating workflows
