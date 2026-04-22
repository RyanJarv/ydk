# Coding Agent Context

## Approach

This direction treats `ydk` as structured context for coding agents. Before changing code, an agent queries `ydk` to understand the purpose path of the files it will touch. After changing code, the agent can use `ydk` to check whether the changed files still have a clear relationship to project intent.

The goal is to supplement a flat project instructions file with a graph the agent can query.

## Session Log

```console
$ agent "Add --json support to the why command"

# The agent starts by asking ydk which purpose path covers the file it expects to edit.
$ ydk why src/cli.ts --json
{
  "target": "src/cli.ts",
  "anchor": {
    "node": "F-001",
    "reason": "Provides the command interface for asking why an artifact exists."
  },
  "trace": [
    { "id": "F-001", "type": "feature", "title": "Explain why a repo artifact exists" },
    { "id": "C-001", "type": "capability", "title": "Resolve implementation artifacts to project intent" },
    { "id": "O-001", "type": "outcome", "title": "Maintainers can answer why a feature exists" },
    { "id": "M-001", "type": "mission", "title": "Help maintainers understand why code exists" }
  ]
}

$ agent edit src/cli.ts src/format/json.ts tests/json-output.test.ts
Edited:
  src/cli.ts
  src/format/json.ts
  tests/json-output.test.ts

# After editing, the agent runs a purpose-aware check.
$ ydk review --changed
Changed files:
  src/cli.ts
    anchored to F-001
    status: ok

  src/format/json.ts
    no anchor found
    likely parent: F-001
    confidence: medium

  tests/json-output.test.ts
    no anchor found
    ignored by policy: tests may anchor indirectly through covered source files

Recommended graph update:
  Anchor src/format/json.ts to F-001
  Add or update a feature node only if JSON output has a distinct current purpose

# The agent presents this to the user instead of inventing project intent silently.
$ agent "I added JSON output. ydk review suggests anchoring the new formatter to
the existing artifact explanation feature. Shall I update .ydk/anchors.yaml?"
```

## Behavior Notes

The important behavior is not that the agent blindly obeys the graph or treats it as an automatic source of truth. The graph gives the agent a structured way to ask better questions:

- What is this file for?
- What result does this feature support?
- Does this change introduce a new purpose or only support an existing one?

For agent use, JSON output is more important than polished human output. The tool should expose stable IDs, edge types, target paths, and anchor reasons.

## Pros and Cons

Pros:

- Gives coding agents precise, repo-local context.
- Reduces reliance on one large instruction file.
- Helps agents explain why they changed `.ydk/` along with code.
- Encourages agents to ask before inventing product intent.

Cons:

- Agents may overfit to stale or incomplete graph data.
- Requires machine-readable output stability.
- The tool needs clear confidence levels if it suggests anchors.
- Too much graph complexity could slow down agent workflows.

## Review Feedback

The reviewer found the agent workflow clear: query intent before editing, then use a purpose-aware review after changing files. They recommended softening the framing so `ydk` reads as structured repo context and confidence, not an automatic source of project intent. They also called out that generated agent notes should be labeled as inferences from `ydk` output.
