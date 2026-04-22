# ydk

`ydk` is a minimal example of a "why development kit": a repo-local purpose graph that can explain why meaningful artifacts exist.

This repository dogfoods the idea. The `.ydk/` directory defines the model, the graph, and the anchors that connect project intent to this repository's own files.

## Try it

```bash
npm install
npm run ydk -- why src/cli.ts
npm run ydk -- trace F-001
npm run ydk -- validate
```

## Configuration

```text
.ydk/
  graph.yaml    # defines this project's current purpose graph
  anchors.yaml  # maps repo artifacts to graph nodes
```

The important split is:

- `graph.yaml` defines this project's current intended purpose.
- `anchors.yaml` defines where that meaning touches the repo.

The first promise of `ydk` is deterministic:

```text
Given a repo artifact, return a valid explanation path from that artifact to the project mission.
```

## Possible Direction Examples

See [./docs/examples](./docs/examples/README.md)

