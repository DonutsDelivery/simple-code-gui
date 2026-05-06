# Plan Review

Review a plan document for quality, completeness, and readiness before approval and derivation. Focuses on what a reviewer uniquely checks — alignment with existing specs, task executability, dependency correctness, and coverage completeness.

Spec language quality and plan document format rules are defined in `{skill:writing-specs}` and `{skill:plan}` respectively. This skill assumes familiarity with both and does not duplicate their content. Review those skills first if you need to refresh on spec or plan conventions.

## When to Use

- Before approving a plan for derivation
- After significant edits to a draft plan
- When a plan has been through iteration and needs a final check

**Not for:** Reviewing task work or PRs (use `{skill:review}`), writing specs (use `{skill:writing-specs}`), or creating plans (use `{skill:plan}`).

## Review Process

### Step 1: Read the Plan

Read the full plan document. Understand the scope, the specs being introduced, and the tasks that implement them. Form your own understanding before checking details.

### Step 2: Review Specs Against Existing System

New specs join an existing hierarchy. This is the highest-value review step — catching conflicts, overlaps, and misplacements that the author may not have seen.

**Investigate the neighborhood:**

```bash
# For each new spec, search for related existing specs
kspec search "<keywords from spec title/description>"

# Get existing specs in the same module
kspec item list --under @parent-module

# Read specs the plan interacts with
kspec item get @referenced-spec
```

**For each new spec, answer:**

- Does an existing spec already cover this behavior (even partially)?
- Does this spec's description or ACs contradict an existing spec?
- Are parent references valid and placed correctly in the hierarchy?
- Would this spec be better as additional ACs on an existing spec rather than a new one?
- Are traits appropriate and correctly referenced?

### Step 3: Review Spec Quality

Apply the behavioral language rules and AC quality standards from `{skill:writing-specs}`. Focus your review on:

- **Atomicity** — Can each AC be tested independently? Split any AC where you could write two separate tests.
- **Completeness** — Are there behaviors in the description not covered by ACs? Are error and boundary cases addressed?
- **Boundaries** — Do specs have clear, non-overlapping responsibilities? If two specs describe similar behavior, flag the overlap.

### Step 4: Review Tasks

Tasks should be executable by an agent picking them up in a fresh session with no chat history. The plan document format rules in `{skill:plan}` define the expected fields. Focus your review on:

**Standalone executability:**

- Does the task describe the what, why, and how concretely enough to act on?
- Are there references to plan discussion context that didn't make it into the task? ("See above," "as discussed," implicit assumptions from the planning conversation)
- Would an agent know which files to touch, which patterns to follow, and how to verify their work?

**Red flags:**

- Vague scope ("implement the feature") without concrete boundaries
- Missing motivation — the task says what to do but not why
- No "Covers:" line linking back to specific ACs
- A single task claiming coverage of many ACs without clear justification

**Coverage mapping:**

- Every AC across all specs should be claimed by at least one task
- If multiple tasks cover the same ACs, the division of responsibility should be annotated
- Orphan ACs not claimed by any task will not get implemented

### Step 5: Review Dependency Ordering

Task dependencies define execution order. Getting this wrong means tasks are attempted before their prerequisites exist, or unnecessarily serialized when they could run in parallel.

**Dependency graph analysis:**

- Map out the dependency chain — which tasks block which
- Check for circular dependencies
- Check for missing dependencies — does task X use something task Y creates without declaring the dependency?
- Check for over-constraining — does a dependency exist that isn't actually needed, artificially serializing parallel work?

**Priority alignment:**

- Higher priority tasks (P1) should generally not depend on lower priority tasks (P2/P3)
- If a P1 depends on a P2, something is likely misordered

**Parallelism opportunities:**

- Tasks at the same priority with no dependencies between them can run in parallel
- Look for tasks serialized by dependency that don't actually need to be
- Look for tasks that should be serialized but aren't

### Step 6: Cross-Reference Validation

Verify all internal references resolve:

- Task `spec_ref` values point to specs in this plan or existing specs
- Task `depends_on` values point to tasks in this plan or existing tasks
- Spec `parent` values point to specs in this plan or existing specs
- "Covers:" lines reference AC IDs that actually exist on the referenced spec
- AC numbering is sequential with no gaps or duplicates within each spec

## Recording the Review

Plan reviews use the kspec review record system. This creates a durable audit trail of what was checked, what was found, and what the verdict was.

### Create the Review Record

```bash
kspec review add \
  --title "Plan review: <plan title>" \
  --subject-type plan \
  --subject-ref @plan-ref
```

### Structure Findings as Threads

Each finding becomes a comment thread with a kind and a structured anchor pointing to the specific part of the plan. Use `--section` and `--field` to target findings precisely, and `--anchor-ref` to reference specific specs or tasks.

```bash
# Blocker on a specific spec's ACs
kspec review comment @review-ref \
  --kind blocker \
  --section acceptance_criteria \
  --anchor-ref @spec-slug \
  --body "ac-3 and ac-4 overlap — both describe idle timeout behavior"

# Question about task design
kspec review comment @review-ref \
  --kind question \
  --section tasks \
  --anchor-ref @task-slug \
  --body "Should the How section keep mechanism-level wording or use behavioral language?"

# Nit on spec description
kspec review comment @review-ref \
  --kind nit \
  --section specs \
  --anchor-ref @spec-slug \
  --field description \
  --body "Description still references protocol terms"

# Record a check that passed
kspec review check @review-ref \
  --name "AC coverage" \
  --status pass \
  --evidence "All 17 ACs claimed by at least one task"

# Record a check that failed
kspec review check @review-ref \
  --name "Dependency ordering" \
  --status fail \
  --evidence "P1 task depends on P2 task — priority misalignment"
```

### Thread Kinds

| Plan review severity | Thread kind |
| -------------------- | ----------- |
| MUST-FIX             | `blocker`   |
| SHOULD-FIX           | `question`  |
| SUGGESTION           | `nit`       |

### Structured Anchors

Anchors let threads point at specific plan areas so the author knows exactly where to look. All anchor fields are optional — use whichever combination targets the finding precisely.

| Anchor                                                          | Use for                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `--section acceptance_criteria --anchor-ref @spec`              | AC quality issues on a spec generally                    |
| `--section acceptance_criteria --field ac-3 --anchor-ref @spec` | Issue with a specific AC                                 |
| `--section description --anchor-ref @spec`                      | Spec description language or clarity                     |
| `--section traits --anchor-ref @spec`                           | Trait selection or usage issues                          |
| `--anchor-ref @task`                                            | Task executability or coverage issues                    |
| `--section description --anchor-ref @task`                      | Task description quality (what/why/how)                  |
| `--section dependencies`                                        | Dependency ordering or priority alignment                |
| `--anchor-ref @spec`                                            | General issue with a spec (hierarchy, boundary, overlap) |

### Verdict

After findings are addressed (or accepted):

```bash
# Approve — plan is ready for derivation
kspec review verdict @review-ref --decision approve

# Request changes — issues need fixing before approval
kspec review verdict @review-ref --decision request_changes
```

### Review Lifecycle

```
create review → add findings as threads → add check results → submit verdict
                                              ↓
                              if needs_work: author fixes, re-imports → re-review
                              if approved: kspec plan set --status approved → derive
```

## Reporting Without a Review Record

When reporting findings informally (e.g., in conversation), group by severity:

**MUST-FIX** — Blocks approval. Factual errors, missing coverage, broken references, spec conflicts.

**SHOULD-FIX** — Quality improvement. Compound ACs, unclear task descriptions, missing dependencies, spec boundary overlap.

**SUGGESTION** — Optional enhancement. Style improvements, additional ACs for edge cases, clarity.

For each finding, state what the issue is, where it is (spec slug + AC ID, or task slug), and what to do about it.

## Integration

- **`{skill:writing-specs}`** — Source of truth for spec language quality and AC rules. Review against those standards.
- **`{skill:plan}`** — Source of truth for plan document format, spec fields, and task fields. Review against those standards.
- **`{skill:review}`** — Task/PR review after implementation begins
- **Codex review** — Can be run in parallel for a second perspective: `/codex review-plan @plan-ref`
