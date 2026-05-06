# Session Reflection

Structured reflection at the end of a work session. Identifies learnings, friction points, and improvements — the raw material for system evolution.

## When to Use

- End of a work session (interactive or automated)
- After completing a significant piece of work
- When you notice recurring patterns worth capturing

## Workflow

### Interactive Mode

```bash
kspec workflow start @session-reflect
```

Six steps, guided by the workflow engine:

1. **What Worked Well** — Identify effective practices
2. **Friction Points** — Where things were harder than needed
3. **Check Coverage** — Search for existing tracking before proposing new items
4. **Propose Improvements** — Concrete ideas for untracked friction
5. **Discussion** — Present to user, get approval one at a time
6. **Capture** — Add approved items to inbox/observations

Use `kspec workflow show` to see progress, `kspec workflow next --notes "..."` to advance.

### Loop Mode (Automated)

```bash
kspec workflow start @session-reflect-loop
```

Key differences from interactive:

- **High confidence only** — Only capture what you're certain about
- **Search first** — MUST search before capturing anything
- **No user prompts** — Skip discussion, auto-resolve
- **Lower volume** — Better to capture nothing than capture noise
- **Higher bar for tasks** — Prefer `inbox add` over `task add` without user confirmation

## Gate: Is There Anything to Reflect On?

Before starting, check if the session had meaningful work:

1. **Tasks completed recently** — Any `completed_at` timestamps from the current session?
2. **Code changes** — Any staged, unstaged, or untracked files?
3. **Recent commits** — Any commits from the current session?

**Skip reflection if** no tasks completed, working tree is clean, and no commits made. Don't manufacture reflection from nothing.

## The Reflection Process

### Step 1: What Worked Well

Be specific — "categorizing items first" not "good planning."

- Workflows that flowed smoothly
- Tools or commands that helped
- Decisions that proved correct
- Patterns worth replicating

### Step 2: Friction Points

Focus on systemic issues, not one-off mistakes.

- Repetitive manual steps
- Missing commands or options
- Context loss or re-explanation needed
- Workarounds used

### Step 3: Check Existing Coverage

**Before proposing anything, search ALL sources:**

```bash
kspec search "<keyword>"  # Searches specs, tasks, AND inbox
```

For each friction point:

- **Already tracked** — Reference the existing item, don't duplicate
- **Partially covered** — Note what's missing
- **Not tracked** — Candidate for capture

### Step 4: Propose Improvements

For untracked friction, propose:

- What it would do
- How it would help
- Rough scope (small/medium/large)

### Step 5: Discussion (Interactive Only)

Present findings one at a time:

- Is this worth capturing?
- Any refinements?
- Related ideas from user perspective?

### Step 6: Capture

Route each item to the right destination:

| What you found                      | Where                   | Why                          |
| ----------------------------------- | ----------------------- | ---------------------------- |
| Clear scope (know what and where)   | `task add`              | Ready to implement           |
| Unclear scope (vague, needs triage) | `inbox add`             | Will be triaged later        |
| Systemic friction pattern           | `meta observe friction` | Informs process improvement  |
| Success pattern                     | `meta observe success`  | Worth documenting            |
| Behavior change needing spec work   | Ask user                | May need spec-first workflow |

**Inbox vs Task:** Can you describe the change and where it goes? Use `task add`. Only use inbox when scope is genuinely unclear.

When capturing 2+ items, use `kspec batch`:

```bash
kspec batch --commands '[
  {"command":"inbox add","args":{"text":"Improvement idea","tag":["reflection"]}},
  {"command":"meta observe","args":{"type":"friction","content":"Friction pattern"}},
  {"command":"meta observe","args":{"type":"success","content":"Success pattern"}}
]'
```

## Reflection Prompts

Use these to surface insights:

- **Process:** What did I repeat 3+ times? What workarounds did I use?
- **Tools:** What command or flag did I wish existed?
- **Communication:** Where was the user surprised? What should I have asked earlier?
- **Learning:** What do I know now that I didn't at session start?

## Key Principles

- **Specific over general** — "No bulk AC add" not "CLI could be better"
- **Systemic over incidental** — Focus on repeatable friction
- **Ask don't assume** — User decides what's worth capturing (interactive mode)
- **Brief on successes** — Friction points are the primary value
- **Search before capture** — Never duplicate existing tracking

## Workflow Commands

```bash
kspec workflow show           # Check current step
kspec workflow next --notes "..."   # Advance with notes
kspec workflow next --skip --notes "reason"  # Skip a step
kspec workflow pause          # Pause for later
kspec workflow resume         # Resume
```

## Integration

- Observations created during reflection feed into `{skill:triage} observations`
- Friction observations may be promoted to tasks via `kspec meta promote @ref`
- Success patterns may inform AGENTS.md or convention updates
