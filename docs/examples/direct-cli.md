# Direct CLI

## Approach

This direction treats `ydk` as a maintainer-facing command line tool. A developer uses it while reading, changing, or deleting code to answer "why does this exist?" without opening a wiki, issue tracker, or long project guide.

The tool stays deterministic: it reads `.ydk/model.yaml`, `.ydk/graph.yaml`, and `.ydk/anchors.yaml`, then traces an artifact to the project mission.

## Session Log

```console
$ pwd
/work/ydk

# A maintainer starts by asking why the CLI entrypoint exists.
$ ydk why src/cli.ts
src/cli.ts
  anchored to F-001
  Provides the command interface for asking why an artifact exists.

F-001 (feature): Explain why a repo artifact exists
supports -> C-001 (capability): Resolve implementation artifacts to project intent
supports -> O-001 (outcome): Maintainers can answer why a feature exists
supports -> M-001 (mission): Help maintainers understand why code exists

# The maintainer can inspect the underlying graph node directly.
$ ydk show F-001
F-001
  type: feature
  title: Explain why a repo artifact exists

Supported by:
  D-001 constrains F-001

Supports:
  F-001 supports C-001

Anchors:
  src/cli.ts
  src/graph/resolveWhy.ts

# The user is considering deleting a file, so they ask for impact.
$ ydk impact src/graph/resolveWhy.ts
src/graph/resolveWhy.ts anchors to F-001

Potential impact:
  F-001: Explain why a repo artifact exists
  C-001: Resolve implementation artifacts to project intent
  O-001: Maintainers can answer why a feature exists
  M-001: Help maintainers understand why code exists

Before deleting this artifact, either:
  - move the anchor to a replacement artifact
  - remove F-001 if the feature is no longer part of the project
  - record a new decision explaining why the feature is being retired

# The maintainer checks whether the graph has stale references.
$ ydk validate
ydk configuration is valid

# Fictional future behavior: coverage finds meaningful files without anchors.
# This is advisory output, not a strict validation failure.
$ ydk coverage
Anchored source files: 5
Unanchored source files: 1
Intent nodes without direct anchors: 2
Nodes that do not reach mission: 0

Unanchored source files:
  src/graph/formatTrace.ts

Intent nodes without direct anchors:
  O-001 Maintainers can answer why a feature exists
  M-001 Help maintainers understand why code exists
```

## Behavior Notes

`ydk why` is the core interaction. It should be fast, local, and boring. The output should avoid interpretation when the graph already contains enough structure.

`ydk impact` is a natural extension of `why`. Instead of only explaining an artifact, it shows what purpose path may be affected by modifying or deleting that artifact.

`ydk coverage` should be advisory rather than strict by default. Mission and outcome nodes may not need direct anchors, so they should be reported separately from source files that probably should have anchors.

## Pros and Cons

Pros:

- Easy to understand and demo.
- Useful without integrating into another system.
- Keeps the model reviewable in git.
- Gives maintainers a low-friction answer to "why does this exist?"

Cons:

- Users must remember to run it.
- The value depends on anchors staying fresh.
- It may be ignored if it feels like extra documentation work.
- It does not automatically influence coding tools or review workflows.

## Review Feedback

Reviewer feedback was positive on the core maintainer workflow: `why` -> `show` -> `impact` -> `validate` makes the tool's value easy to understand. The main correction was to label `coverage` as fictional advisory behavior and avoid implying that mission/outcome nodes are problems just because they do not have direct anchors.
