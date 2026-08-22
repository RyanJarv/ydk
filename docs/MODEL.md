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
- `feature`: a concrete, repeatable product behavior that provides or supports a capability.

Every project must have exactly one `mission` node.

Nodes describe durable product purpose, not tasks, milestones, named onboarding
runs, or other project-management state. Whether the implementation currently
fulfills a node is a separate concern from whether that purpose belongs in the
graph; `ydk` does not currently score that alignment.

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
- Every concrete anchor target must exist on disk or in the relevant package script table.
- Pattern anchors are matched structurally and do not need to exist as a single concrete path.
- `url` anchors name a product surface rather than a repo artifact, so they are checked
  for route syntax only and are never resolved against disk.

These rules are built into `ydk`; they are not configured per repo.

## Per-Repo Configuration

Each repo configures two files, plus an optional third:

```text
.ydk/
  graph.yaml
  anchors.yaml
  ignore
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

Each target kind provides three pieces of behavior:

- how a user query matches the target
- how specific the match is relative to broader targets
- how validation checks whether the target still exists

The target kinds are `file`, `filePattern`, `directory`, `packageScript`, and `url`.

#### Anchor Target Kinds

| Kind | `value` shape | Query form | Validation |
| --- | --- | --- | --- |
| `file` | string file path | `src/cli.ts` | `value` must exist and be a file. |
| `filePattern` | string glob pattern | any path matched by the pattern | Pattern syntax is checked structurally by matching; no single concrete path must exist. |
| `directory` | string directory path | the directory path or any path under it | `value` must exist and be a directory. |
| `packageScript` | object with `path` and `script` | `package.json#test` | `path` must exist, be readable JSON, and contain `scripts[script]`. |
| `url` | string route | `/#/map` or `http://127.0.0.1:4173/#/map` | `value` must be a root-relative route or a valid `http://` or `https://` URL. Nothing is checked on disk. |

`target.value` intentionally changes shape by target kind. Path-like targets use
a string. Targets that identify something inside another artifact use an object.
This keeps the generic target interface from pretending every target is a file
path.

Exact file anchor:

```yaml
version: 1

anchors:
  - target:
      kind: file
      value: src/cli.ts
    node: F-001
    reason: Provides the command interface for adding and inspecting prompt snapshots.
```

Pattern anchor:

```yaml
anchors:
  - target:
      kind: filePattern
      value: .pit/prompts/*.yaml
    node: C-001
    reason: Stores prompt snapshots produced during experiments.
```

Directory anchor:

```yaml
anchors:
  - target:
      kind: directory
      value: docs/examples
    node: C-001
    reason: Explains the docs example set.
```

Package script anchor:

```yaml
anchors:
  - target:
      kind: packageScript
      value:
        path: package.json
        script: build
    node: F-002
    reason: Builds the repository before validation.
```

Url anchor:

```yaml
anchors:
  - target:
      kind: url
      value: /#/map
    node: F-003
    reason: Presents the graph as a layered project map.
```

A `url` anchor names a *product surface* — a route a user can visit — where the
other kinds name implementation. Prefer a root-relative route such as `/#/map`,
since the host and port a project is served on are a deployment detail rather
than product purpose; an absolute `http://` or `https://` URL is allowed for a
surface hosted somewhere else. Queries match either way, so `#/map`, `/#/map`,
and `http://127.0.0.1:4173/#/map` all resolve the same anchor.

Exact file anchors take precedence over directory and pattern anchors.
Package script anchors resolve from `path#symbol` targets such as `package.json#build`.

### ignore

`.ydk/ignore` is optional. It lists paths that `ydk coverage` should leave out of
its file counts: one `filePattern`-style glob per line, matched against
repo-relative paths. Blank lines and lines starting with `#` are ignored.

```text
# editor and agent state, not repo artifacts
.claude/**
.idea/**
```

As in `filePattern` anchors, `*` matches within a single path segment and `**`
crosses segments, so `*.log` matches only root-level logs while `**/*.log`
matches them anywhere. The file only affects coverage counts; it does not change
which anchors resolve or what `ydk validate` checks. `.git/`, `node_modules/`,
and `.ydk/` are always skipped, whether or not this file exists.

## Coverage

`ydk coverage` measures two different things.

Node coverage counts *anchorable* nodes: `capability` and `feature`. Those are
the node types expected to point at something in the repo, so a `mission` or
`outcome` without anchors is not counted as a gap. An anchorable node is
anchored when at least one anchor names it.

File coverage counts the files found by walking the repo, minus anything
`.ydk/ignore` excludes. A file counts as anchored when any anchor target matches
it: an exact `file` path, a `directory` the file sits under, a `filePattern` the
file matches, or the `path` of a `packageScript`. Directory totals roll up from
the files beneath them.

A `url` anchor anchors its node like any other anchor, so a node reached only by
a product surface still counts as anchored. It names no file, so it is left out
of file coverage entirely rather than counted as an unmatched target.

An anchor is *stale* when its target no longer resolves — a missing file or
directory, a package script that is gone from `scripts`, or a `filePattern` that
now matches nothing. Stale anchors are reported separately from coverage because
they mean the graph has drifted from the repo rather than that the repo is
under-anchored. A `url` anchor is never stale: `ydk` cannot tell from the repo
whether a route is still served.

## Browser Explorer

`ydk serve` starts a local web server for browsing the current project graph:

```bash
npm run ydk -- serve
```

The browser UI is intentionally project-focused. It uses the graph to show the
project mission, the result and capability chain beneath it, and the artifacts
anchored to each node. This makes the graph useful as a project map instead of
only a raw node-edge diagram.

It presents that graph three ways, each on its own hash route: an outline
`#/explorer` for reading a node and its anchors, a layered `#/map` for seeing the
shape of the graph, and `#/coverage` for the same report `ydk coverage` prints.

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
