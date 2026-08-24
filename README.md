# ydk

`ydk` is a minimal example of a "why development kit": a repo-local purpose graph that connects meaningful artifacts to their intended purpose.

This repository dogfoods the idea. `ydk` has a small built-in model, and the `.ydk/` directory defines the graph and anchors that connect project intent to this repository's own files.

## Why?

Really this is just an experiment... I'm not actually sure this really makes sense. I think you could probably think of it as effectively comments/documentation in graph form. My hope is that doing this helps expose inconsistencies that come about from generating large amounts of code. LLMs seem to be very good at making the right decision when they have the right information, but they rarely seem to have the right information...

Also... LLMs seem to make all kinds of weird justifications for things when you're not careful to audit the reasoning behind everything. This get's super tiring, I think a tree graph could potentially make this easier, you have your mission statements on the left, just a couple sentences which serve as justification for everything in the project. Something like that.. 

## Progress

> How useful is this project currently?

Likely not very, right now ydk is only used to build ydk.

> What needs to be done to make this project useful?

Right now the project uses Mission, Outcomes, Capabilities, and Features to split up the why graph. This seems a bit confusing to me... need to assess if this should be made simpler. What's the difference between Capabilities and Features? What purpose does each type serve? I suppose this could probably be graphed with ydk...

Once that's sorted out, how anchors and assessments work needs to be reviewed. I think if these things are nailed down then the project would start to be useful.

Right now anchors are kinda just another part of the graph that is rooted in a concrete *thing* in the project rather than an idea and they can be attached to any node in the ydk graph. So they really are just kind of part of the graph, kinda.

## Notes

The [Model](docs/MODEL.md) doc is the agent maintained version. This section is just [Why](#why?) and [Notes](#notes) section is my own current understanding.

Above I said anchors are part of the graph. It might make more sense to think of this all as a two-layer graph:

- Purpose layer: graph.yaml — authored, a DAG with supports edges, validated (single mission, acyclic, reachable).
- Implementation layer: the repo itself — discovered, not authored, and currently has no intra-layer edges of its own (ydk doesn't model imports or containment; the filesystem is just a vertex set).
- Anchors: the bipartite inter-layer edges. Notably your own anchor reason already says this: ".ydk/anchors.yaml — Maps repo artifacts to the purpose graph without adding each artifact as a graph node."

I imagine other projects have modeled the implementation layer so if we ever end up doing anything there maybe worth looking around before inventing something new. So basically, this project just focuses on the Purpose Layer, and Anchors that tie it to the Implementation layer. Also assessments...

### Assessments

Assessments are what I believe will make this project actually useful. They are an evaluation of how well concrete *things* fulfill or are aligned to nodes in the ydk graph, or alternatively, how well nodes are aligned to other nodes. This is probably better thought of properties of the graph edge, but exists as it's own concept currently.

Assessments will eventually be automatically updated when the implementation is reviewed by an agent in the context of the ydk graph and are what reduce the aligned-ness to a number (with reasoning) that can be represented in the web-ui and will eventually guide agents in either correcting the implementation or surfacing issues with the graph.

Changes to the graph are all handled manually currently, but the intention is that they would all be reviewed by the user even if the suggestion is surfaced by an agent.

Ensuring assessments reflect the state of the project aligned-ness in a valuable way and provide valuable information to users and implementations agents will likely be the bulk of the fine tuning work and may be tricky to get right.

### Later

Once everything is working well with higher level concepts the question is how far does it make sense to take this concept... should every function in the project be attached to the graph?

Also what's the best way to have the graph integrated with the project? Right now the ydk graph is an opaque format that get's stuck in a dot folder but would it make more sense as comments alongside the code?


## Try it

```bash
npm install
npm run ydk -- graph
npm run ydk -- why src/cli.ts
npm run ydk -- coverage
npm run ydk -- validate
npm run ydk -- serve
```

`ydk graph` prints the purpose graph as a tree rooted at the mission, with a
rollup of what sits beneath each node:

```text
M-001  Keep project work aligned with its purpose                                                                mission
├── O-001  Maintainers can explain how current implementation supports project purpose  2 caps · 2 features · 21 anchors
│   ├── C-001  Resolve implementation artifacts to project intent                                 1 feature · 17 anchors
│   │   └── F-001  Explain why a repo artifact exists                                                          6 anchors
│   └── C-003  Make the purpose graph comprehensible                                               1 feature · 3 anchors
│       └── F-004  Visualize the purpose graph as a navigable map                                              2 anchors
└── O-002  Maintainers can trust the purpose graph reflects the current repo              1 cap · 2 features · 7 anchors
    └── C-002  Keep the purpose mapping trustworthy and complete                                  2 features · 7 anchors
        ├── F-002  Validate that the current purpose graph reaches the mission                                 4 anchors
        └── F-003  Report how much of the repo is anchored to the purpose graph                                2 anchors
```

`ydk coverage` reports how much of the project is connected to that graph:

```text
  nodes anchored   7 / 7   ██████████  100%
  files anchored  33 / 39  █████████░   85%
  stale anchors    0
```

Add `--depth <n>` or `--flat` to `graph`, `--all-paths` to `why` and `trace`,
and `--unanchored`, `--unanchored-files`, `--stale`, or `--dirs` to `coverage`.
Every command that reads the graph also takes
`--json`. Run `ydk <command> help` for the rest.

## Configuration

```text
.ydk/
  graph.yaml    # defines this project's current purpose graph
  anchors.yaml  # maps repo artifacts to graph nodes
  ignore        # optional: paths to leave out of coverage counts
```

The important split is:

- `graph.yaml` defines this project's current intended purpose.
- `anchors.yaml` defines where that meaning touches the repo.

Supported anchor target kinds are documented in [docs/MODEL.md](./docs/MODEL.md#anchor-target-kinds).

The first promise of `ydk` is deterministic:

```text
Given a repo artifact, return a valid explanation path from that artifact to the project mission.
```

## Project Explorer

`ydk serve` starts a local browser UI for exploring the project as a purpose map:

```bash
npm run ydk -- serve
```

The explorer is one page: the map. It loads `.ydk/graph.yaml`,
`.ydk/anchors.yaml`, and `.ydk/assessments.yaml` and draws the graph as layered
columns, one per node type. Each node carries its assessment score as a coloured
edge, so drift across the whole project is visible at a glance. Selecting a node
highlights its path to the mission, dims everything off it, and opens a detail
section below the map with the node's statement, its anchored artifacts, and
both directions of its assessment findings.

The selected node is a hash route, so any node is linkable: `#/map/F-001` opens
straight to it.

Repo-level coverage stays in the terminal, where `ydk coverage` prints it, and
asking why one artifact exists is also the CLI's job: `ydk why <path>`.

![ydk project explorer](./docs/assets/ydk-serve-map.png)

## Possible Direction Examples

See [./docs/examples](./docs/examples/README.md).

Those examples are exploratory. They include fictional or proposed commands,
API shapes, and workflows to compare possible directions for `ydk`; they should
not be read as current CLI behavior.

## Onboarding Studies

The [bb-private manual onboarding study](./docs/onboarding/bb-private.md) records
how the current graph, anchors, validation, explanation, and coverage behavior
worked against a large real repository. It includes the candidate configuration,
reproducible results, unresolved artifacts, and product friction observed during
the trial.
