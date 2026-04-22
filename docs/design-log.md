# ydk Design Log

This log records notable changes to `ydk` and why they were made.

It is intentionally plain documentation. These entries are historical context,
not nodes in the current-purpose graph. The `.ydk/` graph should stay focused on
the current intended purpose of project artifacts.

## 2026-04-21: Add File Pattern Anchors

While using `ydk` on `pit`, exact file anchors worked for source files but not
for generated project-state artifacts such as `.pit/prompts/P-0001.yaml`.

`ydk validate` passed even though the primary workflow artifacts created by
`pit` were not explainable. That exposed a gap between structural graph validity
and practical purpose coverage.

The fix was to support anchors with:

```yaml
target:
  kind: filePattern
  path: .pit/prompts/*.yaml
```

This lets a project explain a class of artifacts without adding one anchor per
generated file. Exact anchors still take precedence over pattern anchors.

## 2026-04-21: Remove the Configurable Ontology

The first `ydk` model included `.ydk/model.yaml`, custom node types, custom edge
types, and validation rules. While this was flexible, it made the project harder
to understand before the core value was proven.

In practice, the useful workflow was:

```text
artifact -> current purpose -> mission
```

The configurable ontology did not materially improve that loop, so it was
removed from the default implementation.

`ydk` now uses a fixed small model:

- `mission`
- `outcome`
- `capability`
- `feature`
- `supports` edges

Validation checks that there is exactly one mission, every node reaches that
mission, edges reference known nodes, anchors reference known nodes, and the graph
does not contain cycles.

## 2026-04-21: Remove Decision Nodes from the Core Graph

Decision nodes added a historical dimension to a graph that is intended to
represent current project purpose.

Decisions are naturally point-in-time artifacts. They can be superseded, become
stale, or require validity windows. Tracking that correctly would pull `ydk`
toward ADR or requirements-history tooling.

The current goal is simpler:

```text
Every meaningful artifact can trace to the current mission through current
intended purpose.
```

Historical rationale can still live in `docs/`, issues, pull requests, commits,
or ADR-style documents. It should not be required in the `.ydk/` graph unless a
future version has a clear need for it.

