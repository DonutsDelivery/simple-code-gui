---
name: verify
description: Verify Claude Terminal UI changes in an isolated debug instance
---

# Verify Claude Terminal UI changes

1. Build with `npm run build`.
2. Start the isolated app with `scripts/test-env.sh start`; note the reported orchestrator port.
3. Call `debug_instances`, then pass the isolated `instance_port` to every `debug_*` and session tool call.
4. Drive controls with `debug_input_event`, inspect focused DOM geometry/state with `debug_eval`, and capture evidence with `debug_screenshot` plus `Read`.
5. For terminal behavior, use `debug_terminal` and `read_session_output` before and after the interaction.
6. Check `debug_console` at error level after driving the flow.

Never restart or target the Claude Terminal instance containing the current agent session.
