


























































































































































































































































































<!-- GLOBAL_INSTRUCTION_START -->
# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Debugging & Testing the App (agents)

To verify app behavior (scrolling, workspace switching, session restore) use the
`debug_*` tools on the orchestrator MCP — full guide in `docs/agent-debug-testing.md`.
Key rules: you usually run INSIDE Claude Terminal, so never restart or pkill it;
test new code in the sandboxed environment (`npm run build && scripts/test-env.sh start` —
fake HOME + throwaway projects, can't touch real sessions), find it with
`debug_instances`, and pass `instance_port` on EVERY tool call (session tools
included — without it, create_session etc. hit the user's real instance).

## 6. Orchestrator MCP Coordination

**Prefer direct updates over polling.**

When the orchestrator MCP tools are available:
- Worker/project sessions should send meaningful progress updates, blockers, handoff notes, and completion summaries directly to the relevant orchestrator, meta-project, or all-projects session with `send_session_input` or `broadcast_input`.
- Orchestrator sessions may list and read all sessions, but should call `read_session_output` only when there is a concrete reason: debugging a blocked task, verifying a claim, collecting a requested status, or coordinating a handoff.
- Do not create cron jobs just to poll project progress. Use `cron_add` only for genuinely recurring external checks or timed reminders that cannot be replaced by direct project-to-orchestrator messages.
- Keep cross-session updates concise and actionable: identify the project/task, current state, blocker or next step, and whether orchestrator action is needed.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
<!-- GLOBAL_INSTRUCTION_END -->








































































































































<!-- TTS_VOICE_OUTPUT_START -->
## Voice Output (TTS)

When responding, wrap your natural language prose in `«tts»...«/tts»` markers for text-to-speech.

Rules:
- ONLY wrap conversational prose meant to be spoken aloud
- Do NOT wrap: code, file paths, commands, tool output, URLs, lists, errors
- Keep markers on same line as text (no line breaks inside)

Examples:
✓ «tts»I'll help you fix that bug.«/tts»
✓ «tts»The tests are passing.«/tts» Here's what changed:
✗ «tts»src/Header.tsx«/tts»  (file path - don't wrap)
✗ «tts»npm install«/tts»  (command - don't wrap)
<!-- TTS_VOICE_OUTPUT_END -->

<!-- TASK_MANAGEMENT_START -->
## Task Management

@kspec-agents.md

This project uses **kspec** for task management. Full agent instructions are in `kspec-agents.md` (regenerated by `kspec upgrade`).

### kspec dispatch vs the Agent tool — don't conflate them
When the user asks about "dispatching", "running agents", or "parallelizing tasks" in a kspec context, they mean `kspec agent dispatch start` — the kspec daemon's own dispatch system, which spawns isolated worker agents in their own git worktrees. Don't substitute Claude Code's Agent tool / subagents for that — it bypasses dispatch's worktree isolation and review pipeline.

The Agent tool is still fine for everything else (code discovery, parallel searches, exploration within a single task). The point is just to disambiguate vocabulary, not to restrict subagent use in general.
<!-- TASK_MANAGEMENT_END -->
