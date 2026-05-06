# Review

How to review work and use kspec review records. Covers creating reviews, structuring findings, AC coverage verification, and the full review record interface.

## When to Use

- Reviewing submitted work
- Creating or managing review records
- Verifying AC coverage

## Review Principles

### Adversarial Investigation

**Worker claims are hypotheses, not facts.** When a commit message says "all tests pass," verify it. When a note says "fixed the type errors," check they're actually fixed and not suppressed. Workers are not lying — but they are biased toward believing their own work is correct. Your job is to independently verify.

**Read the code before the description.** Start by reading the diff — what changed, what was added, what was removed. Form your own understanding. Only then read the task notes or PR description and compare. This prevents anchoring bias.

**Treat justifications as claims to verify.** "Pre-existing issue," "out of scope," "will be addressed in follow-up," "this is the standard pattern" — these require evidence, not acceptance.

**A clean review is valid.** Not every submission has bugs. If you investigate thoroughly and find nothing wrong, approve. Do not invent findings to justify time spent. The goal is accuracy, not a finding quota.

### Cognitive Biases to Counteract

**Satisfaction of search** — After finding the first issue, your detection rate drops 25-50%. Finding one issue makes it MORE likely there are others. Deliberately increase scrutiny after your first finding.

**Complexity bias** — Simple-looking changes (renames, test rewrites, config changes) receive less scrutiny because they "look safe." These are where semantic bugs hide. Every submission gets the same investigation depth.

**Anchoring** — Don't frame analysis around the author's stated intent. Assess what the code actually does, not what the author says it does.

**Decision fatigue** — On the Nth review, reviewers default to approval. Every approval must be backed by specific evidence of verification.

### Structured Exploration

Before rendering any verdict, complete both deterministic and analytical checks:

**Deterministic checks** (run these, don't reason about them):

```bash
kspec item get @spec-ref                    # Own ACs + inherited trait ACs
kspec validate                              # Trait coverage warnings
# Run the project's test suite
grep -rn "AC: @spec-ref" tests/             # Own AC annotations (adapt path/syntax)
grep -rn "AC: @trait-" tests/               # Trait AC annotations
```

**Analytical checks** (require reading and judgment):

1. Read the diff — every changed file, not just the interesting ones
2. Read surrounding context — unchanged files that interact with changed code
3. Verify spec alignment — for each AC, confirm the code satisfies the behavior
4. Verify at least one worker claim independently
5. Search across categories — correctness, edge cases, error handling, security, test quality, integration

**Complete ALL checks before recording any verdict.** Do not stop at the first finding. Each unrecorded finding becomes a future fix cycle that could have been avoided. Record every issue you find, then submit one verdict covering all of them.

**Verify findings are real, not invented.** Every finding must be backed by evidence you can demonstrate — code you read, tests you ran, commands you executed. Run the test suite. If an AC implies edge case behavior (concurrency, boundary values, error paths), check whether tests actually cover those cases — missing edge case coverage is a must-fix. Do not emit findings based solely on reading code and reasoning about it; execute what you can to confirm.

---

## AC Coverage Verification

### Own AC Coverage

Every acceptance criterion on the spec MUST have at least one annotated test.

```bash
# Get all ACs (own + inherited from traits)
kspec item get @spec-ref

# Search for annotations in test files (adapt to your language/paths)
grep -rn "AC: @spec-ref" tests/
```

Annotations use language-appropriate comment syntax:

```javascript
// AC: @spec-ref ac-1
it('should validate input', () => { ... });
```

```python
# AC: @spec-ref ac-1
def test_validates_input():
    ...
```

Before accepting coverage, confirm each annotation matches the AC text from `kspec item get` — not just the `ac-N` number. A test must actually prove the AC, not just touch the code path.

### Trait AC Coverage

When a spec implements traits, it inherits their ACs. Every inherited AC needs test coverage using the **trait's** ref:

```javascript
// AC: @trait-json-output ac-1
it('should output valid JSON with --json flag', () => { ... });
```

```bash
# kspec validate reports uncovered trait ACs
kspec validate
```

Any "inherited trait AC(s) without test coverage" warning is a blocker.

If a trait AC genuinely doesn't apply, annotate it with a reason:

```javascript
// AC: @trait-json-output ac-3 — N/A: this command has no tabular output
```

Annotations must be standalone line comments, not embedded in block comments.

### Source-Scanning Tests (Reject on Sight)

Any test whose mechanism is reading implementation source files and asserting on their textual content is an automatic MUST-FIX — regardless of what AC it claims to cover, what language it's in, or how the file reading is accomplished. The technique is the problem, not the specific API used.

The test: "does this source file contain this string?" The answer tells you nothing about whether the feature works. These tests create the illusion of coverage while testing nothing, and they are the most common shortcut agents take when ACs are difficult to test behaviorally.

When you encounter source-scanning tests, flag them as MUST-FIX with a request to replace with behavioral tests that exercise the system. If an AC genuinely cannot be tested by exercising behavior, that signals the AC needs revision — not that source scanning is acceptable.

### Spec Alignment

Implementation must match spec intent, not just pass tests:

1. **Implementation exists** — Code handles the described behavior
2. **Test exists** — A test validates the behavior
3. **Behavior matches** — The test actually proves the AC, not just syntactically passes

---

## Review Records

kspec stores first-party review records as durable artifacts in the shadow branch. They track the full lifecycle of reviewing work — threaded comments, check results, verdicts, and audit history.

### Review Lifecycle

```
draft → open → closed
                 ↓
              archived (terminal)
```

| State      | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `draft`    | Review created but not yet started                                |
| `open`     | Active review in progress                                         |
| `closed`   | Review concluded (auto-closed on approve/request_changes verdict) |
| `archived` | Permanently archived                                              |

**Auto-close on verdict:** When a reviewer submits an `approve` or `request_changes` verdict, the review record automatically transitions to `closed`. A `comment` verdict leaves the review open since it doesn't represent a final assessment. Each closed review is a point-in-time artifact.

### Per-Cycle Review Model

Each review cycle produces its own review record. This is analogous to individual PR reviews on GitHub — each review is a discrete artifact with its own verdict, and the collection of reviews across cycles comprises the full review history for the task.

**How it works:**

- When a task enters `pending_review`, the reviewer creates a **new** review record
- If a prior closed review exists, it remains as a historical artifact
- The task's `review_ref` is updated to point to the new record
- Historical reviews are accessible via `kspec review for-task @ref` (returns all linked reviews)

**Do NOT reopen old reviews.** Instead, create a fresh review for each cycle. This keeps each review's findings, verdict, and context self-contained.

### Disposition (Computed)

The disposition is computed from verdicts, checks, and threads — not set directly:

| Disposition         | Condition                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`           | No verdicts, or only `comment` verdicts                                                                                                           |
| `approved`          | At least one `approve` verdict matching current version, no blocking `request_changes`, all required gates passing, no unresolved blocker threads |
| `changes_requested` | Any `request_changes` verdict matching current version, or required gates failing, or unresolved blocker threads                                  |

### Creating Reviews

```bash
# Review a task (auto-links review_ref on the task)
kspec review add --title "Review task-add-auth" \
  --subject-type task --subject-ref @task-add-auth

# Review committed code (requires base/head commits)
kspec review add --title "Review feature branch" \
  --subject-type code --base abc1234 --head def5678 \
  --base-branch main --head-branch feat/auth \
  --related-ref @task-add-auth

# Review a plan or spec
kspec review add --title "Review auth plan" \
  --subject-type plan --subject-ref @plan-auth
```

**Subject types:** `task`, `code`, `plan`, `spec`, `external`

### Structuring Findings as Threads

Each finding becomes a thread with a kind that determines its impact:

```bash
# Blocker — must be resolved before approval
kspec review comment @review-ref \
  --body "Missing error handling for invalid input" --kind blocker

# Question — non-blocking, needs clarification
kspec review comment @review-ref \
  --body "Why was this approach chosen over X?" --kind question

# Nit — non-blocking, minor suggestion (default)
kspec review comment @review-ref \
  --body "Consider renaming this variable" --kind nit
```

**Thread kinds:** `blocker` (blocks approval), `question` (non-blocking), `nit` (non-blocking, default).

Only blocker threads affect disposition. Unresolved nits and questions do not block approval.

#### Code-Targeted Comments

**Always anchor code findings to specific lines.** Use `--path`, `--line-start`, and `--line-end` so the finding is machine-parseable and the UI can render inline context at the exact location:

```bash
kspec review comment @review-ref --body "Off-by-one error" --kind blocker \
  --path src/parser/validate.ts --side head --line-start 42 --line-end 42 \
  --commit def5678
```

For multi-line ranges, set `--line-start` and `--line-end` to span the relevant block.

#### Structured Anchors (for plans/specs)

**Always anchor plan and spec findings to specific sections and fields.** Use `--section`, `--field`, and `--anchor-ref` so the finding is tied to the exact AC, description field, or plan section — not just described in prose:

```bash
kspec review comment @review-ref --body "AC is too vague" --kind blocker \
  --section acceptance_criteria --field ac-3 --anchor-ref @spec-ref
```

Common `--section` values: `acceptance_criteria`, `description`, `context`, `todos`. The `--field` identifies the specific item within that section (e.g., `ac-1`, `ac-2`). The `--anchor-ref` ties the anchor to a specific spec or plan item.

#### Why Anchors Matter

Anchored comments are machine-parseable and enable richer tooling: the UI can render findings inline at the exact location, agents can programmatically match findings to code or ACs, and fix-cycle workers can jump directly to the problem without re-reading the entire diff or spec.

**Unanchored (avoid):**

```bash
# Finding describes location in body text — not machine-parseable
kspec review comment @review-ref \
  --body "In src/parser/validate.ts around line 42, there's an off-by-one error" \
  --kind blocker
```

**Anchored (preferred):**

```bash
# Finding anchored to exact file and lines — UI renders inline, agents can match
kspec review comment @review-ref \
  --body "Off-by-one error: loop should use < instead of <=" --kind blocker \
  --path src/parser/validate.ts --side head --line-start 42 --line-end 42 \
  --commit def5678
```

**Unanchored plan comment (avoid):**

```bash
kspec review comment @review-ref \
  --body "The third acceptance criterion on @spec-auth is too vague" \
  --kind blocker
```

**Anchored plan comment (preferred):**

```bash
kspec review comment @review-ref \
  --body "AC is too vague — 'handles errors properly' needs specific error types" \
  --kind blocker \
  --section acceptance_criteria --field ac-3 --anchor-ref @spec-auth
```

### Recording Checks

Checks record verification evidence bound to the reviewed state. The `applies_to_version` is auto-derived from the review's subject — `code_compare` for code subjects, `entity_version` for task/plan/spec subjects — so callers do not provide version information.

```bash
# Passing test run
kspec review check @review-ref --name "vitest" --status pass \
  --runner vitest --evidence "All 342 tests passed"

# Failing check
kspec review check @review-ref --name "lint" --status fail \
  --runner oxlint --evidence "3 errors found"

# Informational (non-required) check
kspec review check @review-ref --name "coverage" --status pass \
  --no-required --evidence "87% coverage"
```

**Check statuses:** `pass`, `fail`, `running`, `skipped`

Checks whose `applies_to_version` does not match the current subject version are stale.

### Submitting Verdicts

Verdicts record individual reviewer decisions. Like checks, the `applies_to_version` is auto-derived from the review's subject, so callers do not provide version information.

```bash
# Approve
kspec review verdict @review-ref --decision approve \
  --reviewer agent@example.com

# Request changes (triggers needs_work on linked task)
kspec review verdict @review-ref --decision request_changes \
  --reviewer agent@example.com

# Comment (non-blocking)
kspec review verdict @review-ref --decision comment \
  --reviewer agent@example.com
```

Verdicts are per-reviewer. A later verdict from the same reviewer replaces the earlier one for the same version. Verdicts not matching the current subject version are stale.

### Replying and Resolving Threads

```bash
# Reply to a thread
kspec review reply @review-ref --thread <thread-ulid> \
  --body "Fixed in commit abc1234"

# Resolve a thread
kspec review resolve @review-ref --thread <thread-ulid>

# Reopen if fix was insufficient
kspec review reopen @review-ref --thread <thread-ulid>
```

### Fix Cycles (Re-review After Changes)

When a task returns to `pending_review` after a fix cycle, the reviewer creates a **new** review record rather than updating the old one:

```bash
# The old review is already closed (auto-closed on verdict)
# Create a fresh review for the new cycle
kspec review add --title "Review task-foo (cycle 2)" \
  --subject-type task --subject-ref @task-foo

# The task's review_ref now points to this new review
# The prior review remains accessible via for-task
kspec review for-task @task-foo  # Shows all reviews, current + historical
```

When reviewing a fix cycle, read the prior review's threads. If the worker resolved threads, verify their resolutions are correct — a resolved thread is a claim that the issue was fixed, not proof. Reopen threads where the fix is insufficient.

If dispatch workspace metadata is available, the new review's orientation will include a diff summary showing what changed since the prior review's examined commit.

**Subject refresh** is still available for within-cycle updates (e.g., reviewer pushes a minor fix before verdicting):

```bash
kspec review refresh @review-ref --head new-commit-sha
```

### Task Integration

Reviews integrate with the task lifecycle:

- Creating a task review auto-sets `task.review_ref` to the new review
- A `request_changes` verdict auto-transitions `pending_review` tasks to `needs_work` and auto-closes the review
- An `approve` verdict auto-closes the review
- `kspec review for-task @ref` finds **all** linked reviews (current + historical)

---

## Finding Validation

Before emitting any finding, apply the **claim-disprove-emit** cycle:

1. **State the claim.** What exactly is wrong? Be specific: file, line, behavior.
2. **Try to disprove it.** Look for evidence the code is correct — guard clauses, tests covering the case, spec decisions justifying the approach.
3. **If disproved, drop it.** Dropped candidates are the process working correctly.
4. **If still valid, assess severity and confidence.**

### Finding Quality

Every finding must include:

- **Path and line** — exactly where the issue is
- **Anchor** — use CLI anchor flags (`--path`/`--line-start`/`--line-end` for code, `--section`/`--field`/`--anchor-ref` for plans/specs) so the finding is machine-parseable, not just described in body text
- **Claim** — what is wrong, stated precisely
- **Impact** — what breaks, what guarantee is lost
- **Evidence** — what you observed that proves the claim

### Severity Guide

| Severity       | When to use                                                                               |
| -------------- | ----------------------------------------------------------------------------------------- |
| **MUST-FIX**   | Correctness, security, spec violation, coverage loss. High or medium confidence required. |
| **SHOULD-FIX** | Likely correctness issue, missing boundary case, fragile code.                            |
| **SUGGESTION** | Pure style, naming, formatting. Zero correctness implications.                            |

**Default to MUST-FIX.** Only downgrade when you are certain the issue is cosmetic.

---

## Reviewer Workflow Summary

1. **Discover context** — `kspec task get @ref`, `kspec item get @spec-ref`
2. **Create review** — `kspec review add --subject-type task --subject-ref @ref` (creates a new record each cycle)
3. **Open review** — `kspec review open @review-ref`
4. **Investigate** — deterministic checks, then analytical checks
5. **Record ALL findings** — `kspec review comment` for each finding with appropriate kind. **Always use anchors:**
   - Code reviews: `--path`, `--line-start`, `--line-end`, `--commit` to pin findings to exact source locations
   - Plan/spec reviews: `--section`, `--field`, `--anchor-ref` to pin findings to specific ACs or fields
6. **Record checks** — `kspec review check` for test/lint results
7. **Verify completeness** — Before submitting a verdict, confirm you have searched all categories, recorded every finding, and verified each finding with evidence. A review with one blocker and an immediate verdict is almost always incomplete. Each fix cycle costs time — find everything in one pass. Equally, do not invent findings — every issue must be backed by evidence you ran or read, not just suspicion.
8. **Submit verdict** — `kspec review verdict` (approve or request_changes — auto-closes the review)

---

## CLI Lookups

| Need                             | Command                           |
| -------------------------------- | --------------------------------- |
| Spec + all ACs (own + inherited) | `kspec item get @spec-ref`        |
| Trait definition + ACs           | `kspec item get @trait-slug`      |
| Review details                   | `kspec review get @review-ref`    |
| Reviews for a task               | `kspec review for-task @task-ref` |
| All open reviews                 | `kspec review list --status open` |
| Search by keyword                | `kspec search "keyword"`          |
| All traits                       | `kspec trait list`                |
| Validation                       | `kspec validate`                  |

## Command Reference

```bash
# Create and query
kspec review add [options]              # Create a review record
kspec review get <ref>                  # Show review details
kspec review list [--status, --disposition, --subject-type, --reviewer, --task]
kspec review for-task <ref>             # Find reviews linked to a task

# Comments and threads
kspec review comment <ref> [options]    # Add a comment thread
kspec review reply <ref> --thread <ulid> --body "..."
kspec review resolve <ref> --thread <ulid>
kspec review reopen <ref> --thread <ulid>

# Checks and verdicts
kspec review check <ref> [options]      # Record a check result
kspec review verdict <ref> [options]    # Set a reviewer verdict

# Lifecycle
kspec review open <ref>                 # draft → open
kspec review close <ref>                # → closed
kspec review archive <ref>              # → archived (permanent)

# Subject management
kspec review refresh <ref> --head <commit> [--base <commit>]
```

## Integration

- **`{skill:merge}`** — Merge gate checks review disposition before merging
- **`{skill:writing-specs}`** — If review reveals spec gaps, update specs first
- **`kspec validate`** — Automated validation complements manual review
