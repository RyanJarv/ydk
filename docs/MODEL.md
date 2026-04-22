# ydk Model

`ydk` uses a small built-in model for current project purpose.

The model is intentionally not configurable in the initial version. Each repo
configures its own purpose graph and artifact anchors, but not the ontology or
validation rules used by `ydk`.

## Built-In Node Types

`ydk` supports four node types:

- `mission`: the top-level reason the project exists.
- `outcome`: an observable result that supports the mission.
- `capability`: a durable ability the project needs in order to produce an outcome.
- `feature`: a concrete behavior that provides or supports a capability.

Every project must have exactly one `mission` node.

## Built-In Edge Types

`ydk` supports one edge type:

- `supports`: the source node helps achieve the target node.

Example:

```yaml
edges:
  - from: F-001
    to: C-001
    type: supports
```

This means feature `F-001` supports capability `C-001`.

## Validation Rules

`ydk validate` currently applies these fixed rules:

- There must be exactly one `mission` node.
- Node types must be one of `mission`, `outcome`, `capability`, or `feature`.
- Edge types must be `supports`.
- Every edge must reference existing nodes.
- The mission node must not support another node.
- The graph must not contain cycles.
- Every node must trace to the mission.
- Every anchor must reference an existing node.

These rules are built into `ydk`; they are not configured per repo.

## Per-Repo Configuration

Each repo configures two files:

```text
.ydk/
  graph.yaml
  anchors.yaml
```

### graph.yaml

`graph.yaml` defines the repo's current purpose graph.

Example:

```yaml
version: 1

nodes:
  - id: M-001
    type: mission
    title: Help contributors compare project-generating prompts
    statement: >
      The project exists so contributors can understand which prompts produce
      useful implementation results.

  - id: O-001
    type: outcome
    title: Contributors can compare prompt results

  - id: C-001
    type: capability
    title: Store prompt snapshots

  - id: F-001
    type: feature
    title: Add and inspect prompt snapshots

edges:
  - from: O-001
    to: M-001
    type: supports

  - from: C-001
    to: O-001
    type: supports

  - from: F-001
    to: C-001
    type: supports
```

### anchors.yaml

`anchors.yaml` maps repo artifacts to graph nodes.

Exact file anchor:

```yaml
version: 1

anchors:
  - target:
      kind: file
      path: src/cli.ts
    node: F-001
    reason: Provides the command interface for adding and inspecting prompt snapshots.
```

Pattern anchor:

```yaml
anchors:
  - target:
      kind: filePattern
      path: .pit/prompts/*.yaml
    node: C-001
    reason: Stores prompt snapshots produced during experiments.
```

Exact file anchors take precedence over pattern anchors.

## What Was Removed

Earlier versions of `ydk` included `.ydk/model.yaml`, which let each repo define
custom node types, custom edge types, allowed type pairings, and validation
flags. That configurable ontology was removed to simplify the initial version of
`ydk`.

This may be worth reconsidering later if real projects show a clear need for
custom node or edge types.

Decision nodes and `.ydk/decisions/` were also removed from the core model.
Historical rationale can still live in `docs/`, issues, pull requests, commits,
or ADR-style documents, but the `.ydk/` graph should represent current intended
purpose.

