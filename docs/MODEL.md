# ydk Model

`ydk` uses a small built-in model for current project purpose.

The model is intentionally not configurable in the initial version. Each repo
configures its own purpose graph and artifact anchors, but not the ontology or
validation rules used by `ydk`.

## Two Layers, One Coupling

The model is best read as two graphs joined by a coupling — what network theory
calls a two-layer graph and requirements engineering calls a traceability
graph.

- The **purpose layer** is `graph.yaml`: authored, validated, a DAG of
  mission, outcome, capability, and feature nodes joined by `supports` edges.
  It is the desired state of the project.
- The **implementation layer** is the repo itself: discovered rather than
  authored. `ydk` gives it no edges of its own — files, directories, package
  scripts, and product routes are a vertex set read from the working tree.
- **Anchors** are the inter-layer edges. Each anchor joins one artifact to one
  purpose node, and no anchor ever runs within a layer, which makes the anchor
  set a bipartite graph between the two.

The layers earn different treatment. The purpose layer carries authored
invariants, enforced by `ydk validate`: one mission, no cycles, every node
reaching the mission. The implementation layer's truth is the filesystem, so
nothing about it is declared or validated on its own. Keeping artifacts out of
`graph.yaml` — anchored rather than added as nodes — is what keeps each
layer's rules coherent.

The derived concepts all live on the coupling rather than inside either layer.
Coverage counts vertices with no inter-layer edge, on each side: unanchored
nodes and unanchored files. A stale anchor is an inter-layer edge whose
implementation endpoint is gone. An assessment is a judgment recorded against
the coupling: how well the artifacts on one end fulfill the node on the other.
`ydk why` crosses the coupling once, then walks the purpose layer to the
mission.

The separation also leaves room to grow. If the implementation layer ever
gains edges of its own — imports, containment, call relationships — they land
in that layer without touching the purpose model or the anchor format.

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
graph, so that judgment is recorded outside the node, in `.ydk/assessments.yaml`.
See [Assessments](#assessments).

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
- Every assessment must reference an existing node of an anchorable type.
- Every assessment must carry an integer `score` from 0 to 4 and an `assessed` date
  of the form `YYYY-MM-DD` that names a real day.
- A node may be assessed at most once.

These rules are built into `ydk`; they are not configured per repo.

## Per-Repo Configuration

Each repo configures two files, plus two optional ones:

```text
.ydk/
  graph.yaml
  anchors.yaml
  assessments.yaml
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

### assessments.yaml

`assessments.yaml` is optional. It records how well each node's anchored
artifacts fulfill what that node claims. A repo with no such file is a valid
repo with no assessments.

```yaml
version: 1

assessments:
  - node: C-001
    score: 3
    assessed: 2026-08-23
    unfulfilled:
      - Trace only returns the first path; multi-parent nodes are unexplained.
    undeclared:
      - targetResolver also does display formatting, which no node claims.
```

| Field | Required | Shape |
| --- | --- | --- |
| `node` | yes | The id of an existing `capability` or `feature` node. |
| `score` | yes | Integer from 0 to 4. |
| `assessed` | yes | Date the judgment was made, as `YYYY-MM-DD`. |
| `unfulfilled` | no | Strings naming purpose the node claims that its artifacts do not deliver. Defaults to empty. |
| `undeclared` | no | Strings naming behavior in those artifacts that the node's claim does not cover. Defaults to empty. |

`node` is restricted to the anchorable types for the same reason node coverage
counts only those: a `mission` or `outcome` is fulfilled through the nodes
beneath it rather than by artifacts of its own.

At most one entry may exist per node. `ydk` loads, validates, and displays these
judgments; it never produces them. They are written by a person or an agent
reading the code.

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

## Assessments

Coverage answers whether a node points at anything. An assessment answers a
different question: given that a node points at something, how well does that
something do what the node says? Coverage can be complete while the
implementation behind it barely serves the purpose it claims.

An assessment judges **one node against its own direct anchors**. It never
traverses graph edges. A capability gets no credit for the artifacts anchored to
the features beneath it, even though those features support it — that is a
separate question about how coherently a node's children add up to the node, and
`ydk` does not answer it yet. So a capability whose only anchors are two design
documents is judged on those two documents, however much working code hangs off
its features.

### Score Rubric

| Score | Meaning |
| --- | --- |
| 0 | The anchored artifacts do not serve the stated purpose. |
| 1 | Tangential; the claim is mostly unmet. |
| 2 | Partial; the core is met but with significant gaps. |
| 3 | The artifacts fulfill the stated purpose. |
| 4 | They fulfill it completely, with no findings in either direction. |

A score of 4 means both finding lists are empty. If either list has an entry,
the score belongs below 4.

### Making an Assessment

To assess a node:

1. Read the node's `title` and `statement`. That is the claim being tested.
2. List the anchors that name this node, and read each anchor's `reason` — the
   reason is what the repo asserts the artifact contributes.
3. Read the anchored artifacts themselves. The judgment is about what the code,
   documents, and surfaces actually do, not about what the anchors say they do.
4. Record findings in both directions. `unfulfilled` names purpose the node
   claims that the artifacts do not deliver. `undeclared` names behavior in the
   artifacts that the node's claim does not cover. The second direction matters
   as much as the first: it is how drift between the graph and the repo becomes
   visible, and it often means either the node's statement is too narrow or the
   artifact is doing something that belongs elsewhere.
5. Pick the score that matches the rubric, and set `assessed` to the date.

An anchorable node with **no anchors** should not get an assessment entry at
all. Coverage already reports it as unanchored; assessing it would report the
same gap twice. Validation does not reject such an entry, since the rule is a
convention about what is worth recording rather than a structural constraint.

### Freshness

The `assessed` date is the only freshness signal `ydk` keeps. Nothing marks an
assessment stale when the artifacts beneath it change, and nothing recomputes a
score. Re-assessment is manual and happens at the maintainer's discretion; the
date is there so a reader can weigh a judgment against how much the repo has
moved since it was made.

### Where Assessments Appear

`ydk coverage` shows a score beside each assessed node and adds one summary row
counting how many anchorable nodes have been assessed, with their average score.
A repo with no assessments file gets the report exactly as it was before. The
browser explorer bands every node on the map by its score, rolling the average
of a subtree up onto the mission and outcome above it, and spells out both
finding lists in the detail section of the selected node.

## Browser Explorer

`ydk serve` starts a local web server for browsing the current project graph:

```bash
npm run ydk -- serve
```

The browser UI is intentionally project-focused. It uses the graph to show the
project mission, the result and capability chain beneath it, and the artifacts
anchored to each node. This makes the graph useful as a project map instead of
only a raw node-edge diagram.

It presents that graph as a single page, `#/map`: a layered map for seeing the
shape of the graph and where it has drifted, with a detail section below it for
reading the selected node, its anchors, and its assessment findings. The
selected node is part of the route, so `#/map/F-001` links to one node.

Two reports stay in the terminal rather than on that page. `ydk coverage` prints
the repo-level report, which is a per-directory ledger the map has no room for
and no need of, and `ydk why` explains a single artifact without the browser
needing a code browser of its own.

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
