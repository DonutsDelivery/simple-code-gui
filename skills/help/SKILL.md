# kspec Help

Get help with kspec commands and workflows.

## When to Use

Use this skill when:

- You need to understand kspec commands
- You want to learn about task and spec workflows
- You need help with CLI syntax

## Quick Reference

```bash
# Core commands
kspec help                    # Show all commands
kspec help <command>          # Show command help
kspec task list               # List tasks
kspec tasks ready             # Show ready tasks
kspec item list               # List spec items

# Task lifecycle
kspec task start @ref         # Start working
kspec task note @ref "..."    # Add note
kspec task submit @ref        # Submit for review
kspec task complete @ref      # Mark complete

# Spec management
kspec item add --title "..."  # Create spec item
kspec item ac add @ref --given "..." --when "..." --then "..."
```

## Key Concepts

- **Spec items**: Define WHAT to build (requirements, features)
- **Tasks**: Track the WORK of building
- **Shadow branch**: Separate branch for spec/task state
