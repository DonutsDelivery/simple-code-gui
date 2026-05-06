# Task Work

Structured workflow for working on tasks. Full lifecycle from start through completion.

## When to Use

- Starting work on a ready task
- Continuing in-progress or needs_work tasks
- Ensuring consistent task lifecycle with notes and audit trail

**Not for:** Spec creation (use `{skill:writing-specs}`), plan translation (use `{skill:plan}`), or triage (use `{skill:triage}`).

## Inherit Existing Work First

Before starting new work, check for existing work:

```bash
kspec session start  # Shows active work at the top
```

Priority order:

1. **needs_work** — Fix cycle: address review feedback (highest priority)
2. **in_progress** — Continue work already started
3. **ready (pending)** — New work to start

Always inherit existing work unless explicitly told otherwise. This prevents orphaned tasks.

## Task Lifecycle

```
pending → in_progress → pending_review → completed
              ↓              ↓
          blocked        needs_work
                     (→ in_progress → pending_review)
```

| Command                                   | Transition       | When                        |
| ----------------------------------------- | ---------------- | --------------------------- |
| `kspec task start @ref`                   | → in_progress    | Beginning work              |
| `kspec task submit @ref`                  | → pending_review | Work done, ready for review |
| `kspec task complete @ref --reason "..."` | → completed      | Reviewed and merged         |
| `kspec task block @ref --reason "..."`    | → blocked        | External blocker            |

## CLI Lookups

Use CLI commands to find information. **Do NOT search `.kspec/` YAML files manually** — it wastes time and misses context that CLI commands provide (like inherited trait ACs).

| Need                             | Command                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Task details                     | `kspec task get @ref`                                                             |
| Spec + all ACs (own + inherited) | `kspec item get @ref`                                                             |
| Trait definition + ACs           | `kspec item get @trait-slug`                                                      |
| Search by keyword                | `kspec search "keyword"`                                                          |
| List by type                     | `kspec item list --type feature`                                                  |
| All traits                       | `kspec trait list`                                                                |
| Task's linked spec               | `kspec task get @ref` → read `spec_ref` field                                     |
| Task's linked plan               | `kspec task get @ref` → if `plan_ref` is non-null, run `kspec plan get @plan-ref` |
| Reviews for a task               | `kspec review for-task @ref`                                                      |

**Key pattern:** When `kspec item get` output shows "Inherited from @trait-slug", run `kspec item get @trait-slug` to see the trait's ACs. One command — do not grep YAML files.

## Workflow Steps

### 1. Choose Task

```bash
kspec tasks ready                # All ready tasks
kspec tasks ready --eligible     # Automation-eligible only
```

### 2. Verify Work Is Needed

Before starting, check if work is already done:

```bash
# Check git history
git log --oneline --grep="feature-name"
git log --oneline -- path/to/relevant/files

# Check existing implementation
kspec item get @spec-ref  # View spec and ACs
```

If already implemented: verify tests pass, AC coverage exists, then `kspec task complete @ref --reason "Already implemented"`.

**Notes are context, not proof.** If a task has notes saying "already done" — verify independently. Run tests, check code, validate against ACs. If a task is in the ready queue, there's a reason.

### 3. Start Task

```bash
# Check task links first
kspec task get @ref

# If plan_ref is non-null, load implementation context from the plan
kspec plan get @plan-ref

# Then start work
kspec task start @ref
```

### 4. Branch Isolation (Required Before Edits)

Immediately after starting and before any file edits, create or switch to a dedicated branch.

```bash
# Preferred: deterministic dispatch-compatible branch
kspec task branch @ref
```

`kspec task branch` creates or resumes the branch `dispatch/task/<normalized-slug>/<short-task-ref>`. This ensures:

- **Dispatch continuity** — reviewer and fix-cycle agents can find and resume the branch
- **No naming collisions** — the branch name is deterministic from the task identity
- **Remote rehydration** — if the branch exists only on the remote, the command fetches it

If you need a non-dispatch branch (e.g., for work not tied to a task), use conventional prefixes (`feat/`, `fix/`, etc.) instead.

### 4a. Rebase on Target (Required Before Starting Work)

Before writing any code, rebase onto the integration target to stay current:

```bash
git fetch origin
git rebase origin/<integration-branch>  # e.g., dev or main
```

In dispatch mode, the dispatch engine handles branch creation (step 4), so only the rebase in this step is needed.

This keeps your branch fresh with the latest integrated work and lets you resolve conflicts early — while you have full context of your changes. If the rebase has conflicts:

- **Simple textual conflicts** — resolve them inline. You have the best context for your own changes.
- **Complex semantic conflicts** — resolve if you understand both sides. If genuinely uncertain about the correct resolution, block with a reason explaining the conflict.

Do this every time you start or resume work on a task, not just the first time.

### 5. Plan Before Code

**Do not start writing code until you complete this step.** Read all ACs and plan your approach:

```bash
kspec item get @spec-ref  # Shows own ACs AND inherited trait ACs
```

For each AC, identify:

- **Existing code to reuse** — Search the codebase for related functions, utilities, and patterns before creating anything new. Reimplementing existing helpers is a common review blocker.
- **Edge cases implied by the AC** — If an AC describes concurrent behavior, think beyond the simple 2-actor case. If it says "atomic," consider partial failure. Read the AC literally and think about what would break it.
- **Test cases that will prove each AC** — List them before writing production code. This surfaces gaps in your understanding early.

Record your planned approach as a task note:

```bash
kspec task note @ref "Approach: reusing existing X for Y.
Edge cases: A, B, C.
Test plan: N ACs × 1+ test each, plus trait ACs."
```

### 6. Write Tests First

Write test skeletons from your AC analysis **before** implementing production code. For each AC, create an annotated test with the expected behavior described — then implement code to make the tests pass. This ensures coverage is driven by the spec, not retrofitted to the implementation.

**Tests must exercise behavior, not inspect source code.** A test that reads implementation files and asserts on their textual content is never valid AC coverage — regardless of language, framework, or technique used to read the file. These tests fail when the implementation is refactored (even though behavior is preserved) and pass when behavior breaks (as long as the string is still there). They create false coverage and false regressions simultaneously.

The distinction: a behavioral test _runs_ the system and checks what it _does_. A source-scanning test _reads_ the code and checks what it _says_. Only behavioral tests count as AC coverage.

Valid approaches: call the function, run the command, make the request, render the component, execute the pipeline. Check outputs, side effects, exit codes, responses, and rendered results.

### 7. Implement and Note

Add notes during work, not just at the end:

```bash
# Good: explains decisions and context
kspec task note @ref "Using retry with exponential backoff. Chose 3 max retries based on API rate limits."

# Bad: no context
kspec task note @ref "Done"
```

Note when you:

- Discover something unexpected
- Make a design decision
- Encounter a blocker
- Complete a significant piece

### 8. AC Test Annotations

Every acceptance criterion should have at least one test annotated with a comment linking it to the AC. Use the comment syntax appropriate for the language:

```javascript
// AC: @spec-ref ac-1
it('should validate input when given invalid data', () => { ... });
```

```python
# AC: @spec-ref ac-1
def test_validates_input():
    ...
```

```sql
-- AC: @spec-ref ac-1
```

```html
<!-- AC: @spec-ref ac-1 -->
```

The pattern is always: language-appropriate comment + `AC: @spec-ref ac-N`.

For **inherited trait ACs**, use the trait's ref, not the spec's ref:

```javascript
// AC: @trait-json-output ac-1
it('should output valid JSON with --json flag', () => { ... });
```

If a trait AC genuinely doesn't apply, annotate it with a reason:

```javascript
// AC: @trait-json-output ac-3 — N/A: this command has no tabular output to format
```

Annotations must be standalone line comments, not embedded inside block comments or docstrings.

### 9. Regenerate Derived Files

If your task modified any of these source files, regenerate before committing:

| Modified                                                | Regenerate with         |
| ------------------------------------------------------- | ----------------------- |
| `templates/skills/` or `.kspec/skills/`                 | `kspec skill render`    |
| `templates/agents-sections/`, conventions, or workflows | `kspec agents generate` |

Commit the regenerated output alongside your source changes.

### 10. Commit

Include task and spec trailers:

```
feat: add user authentication

Implemented JWT-based auth with refresh tokens.

Task: @task-add-auth
Spec: @auth-feature
```

Trailers enable `kspec log @ref` to find related commits.

### 9. Quality Check

Before submitting, verify:

- **Own AC coverage** — Each spec AC has an annotated test
- **Trait AC coverage** — Each inherited trait AC has an annotated test (or N/A annotation)
- **Tests pass** — Full test suite, not just new tests
- **Code quality** — Matches existing patterns, no duplicated utilities
- **No regressions** — Existing tests still pass

```bash
kspec validate  # Reports uncovered trait ACs as warnings
```

### 10. Submit

Submit transitions the task to `pending_review`. This signals that work is complete and ready for review.

```bash
kspec task submit @ref
```

The reviewer (human or agent) takes over from here. See `{skill:review}` for the review process and `{skill:merge}` for the merge process.

## Fix Cycle

When inheriting a `needs_work` task, the review feedback lives in kspec review records. Each fix cycle creates a new review record — the reviewer does not reopen the prior review.

1. **Read the review** — Find and read ALL review threads, not just the first blocker

   ```bash
   kspec review for-task @ref              # Find all reviews (current + historical)
   kspec review get @review-ref            # Read full review with threads
   ```

2. **Re-read all ACs** — Don't just fix the flagged issue. Re-read every AC on the spec and verify your full implementation against each one. Fixing one issue often introduces or reveals others. A narrow fix that ignores the broader spec is likely to produce another fix cycle.

3. **Address all threads** — Blockers must be resolved before re-approval. Questions and nits are non-blocking but should be addressed. Fix everything the reviewer found in one pass — don't fix one blocker and resubmit hoping the rest will pass.

4. **Reply and resolve threads** — For each thread you addressed, reply explaining what you did, then resolve the thread. This gives the next reviewer clear signal of what was addressed and lets them verify the resolution rather than re-discovering the original issue.

   ```bash
   kspec review reply @review-ref --thread <ulid> --body "Fixed: <description of what was changed and why>"
   kspec review resolve @review-ref --thread <ulid>
   ```

5. **Push fixes** — Commit with descriptive message

   ```bash
   git add <files> && git commit -m "fix: address review feedback

   Task: @task-slug"
   ```

6. **Note what changed** — Before resubmitting, add a task note summarizing what was fixed and why. This note becomes a key entry in the activity timeline and gives the next reviewer context on what changed since the prior review.

   ```bash
   kspec task note @ref "Fix cycle N: addressed all review threads. Fixed X (blocker), Y (nit). Also re-verified ACs 1-5 against implementation."
   ```

7. **Re-submit** — `kspec task submit @ref` (back to pending_review, reviewer creates a new review record)

You do NOT merge in a fix cycle. The reviewer handles merge decisions.

## Scope Management

### What's In Scope

Tasks describe expected outcomes, not rigid boundaries:

- **Tests need implementation?** Implementing missing functionality is in scope — the goal is verified behavior
- **Implementation needs tests?** Proving it works is always in scope

### When to Expand vs Escalate

**Expand** (do it yourself):

- Additional work is clearly implied by the goal
- Proportional to the original task
- You have the context

**Escalate** (capture separately):

- Scope expansion is major
- Uncertain about the right approach
- Outside your task's domain

**When you notice something outside your task:** Capture it separately (`kspec inbox add` or `kspec task note`). Don't fix it inline — even small detours compound into drift.

## Blocking Rules

**Block only for genuine external blockers:**

- Human architectural decision needed
- Spec clarification required
- External dependency unavailable
- Formal `depends_on` blocker

**Do NOT block for:**

- Task seems complex (do the work)
- Tests are failing (fix them)
- Service needs running (start it)

After blocking:

```bash
kspec task block @ref --reason "Reason..."
kspec tasks ready --eligible  # Check for other work
# If tasks exist: work on the next one
# If empty: stop responding (agent dispatch exits automatically)
```

## Command Reference

```bash
# Task lifecycle
kspec task start @ref
kspec task branch @ref               # Create/resume dispatch-compatible branch
kspec task note @ref "..."
kspec task submit @ref
kspec task complete @ref --reason "..."
kspec task block @ref --reason "..."

# Task discovery
kspec tasks ready
kspec tasks ready --eligible
kspec task get @ref

# Review integration
kspec review for-task @ref           # Find linked reviews
kspec review get @review-ref         # Read review details

# Validation
kspec validate
kspec validate --alignment
```

## Integration

- **`{skill:review}`** — Review process for submitted work
- **`{skill:merge}`** — Merge approved work into integration branch
- **`{skill:writing-specs}`** — Create specs before deriving tasks
- **`{skill:plan}`** — Plans create specs that become tasks
- **`{skill:observe}`** — Capture friction found during task work
