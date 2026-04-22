# CI Guardrails

## Approach

This direction treats `ydk` as a lightweight project-governance check in CI. The goal is not to block every unanchored file, but to make purpose drift visible during pull requests.

The project can decide which checks are warnings, which are failures, and which paths are ignored.

## Session Log

```console
$ git checkout -b add-json-output
Switched to a new branch 'add-json-output'

# The developer adds a new output formatter.
$ git diff --name-only
src/format/json.ts
src/cli.ts
tests/json-output.test.ts

# Locally, the branch fails because a new source file is not anchored.
$ ydk ci
ydk ci failed

Errors:
  New source artifact has no anchor:
    src/format/json.ts

Suggested next step:
  ydk propose-anchor src/format/json.ts

# Speculative future behavior: ydk can propose config changes for review.
# The command prints a suggestion; it does not silently edit project intent.
$ ydk propose-anchor src/format/json.ts
Suggested anchor:

  - target:
      kind: file
      path: src/format/json.ts
    node: F-001
    reason: Formats why/trace output for machine-readable consumers.

Reasoning:
  src/format/json.ts is imported by src/cli.ts
  src/cli.ts is anchored to F-001
  F-001 supports the artifact explanation workflow

# The developer adds the anchor. They only edit the graph if JSON output is a
# distinct current purpose rather than an implementation detail of F-001.
$ vim .ydk/anchors.yaml

$ git diff -- .ydk
diff --git a/.ydk/anchors.yaml b/.ydk/anchors.yaml
+  - target:
+      kind: file
+      path: src/format/json.ts
+    node: F-001
+    reason: Formats why/trace output for machine-readable consumers.

# The CI check now passes.
$ ydk ci
ydk ci passed

Summary:
  Changed anchored artifacts: 2
  New anchored artifacts: 1
  Nodes that do not reach mission: 0
```

## Behavior Notes

`ydk ci` can be stricter than `ydk validate`. Validation checks whether the configuration is internally coherent. CI checks whether a proposed change maintains the project's explanation coverage.

Useful optional CI policies could include:

- New files under `src/` require anchors.
- New graph nodes must reach the mission.
- Removed files must not leave broken anchors.
- Changed public APIs should be connected to a feature.

These should be configurable, not universal defaults. A prototype could start with warnings and let a project promote specific checks to failures after the workflow proves useful.

The speculative `ydk propose-anchor` command shows a possible assistant workflow. It should produce a patch suggestion, not silently modify configuration.

## Pros and Cons

Pros:

- Makes purpose drift visible during code review.
- Turns `.ydk/` into a living project artifact.
- Helps teams catch stale anchors before they accumulate.
- Works well with bots and pull request checks.

Cons:

- Can become annoying if policies are too strict.
- Requires path ignore rules for generated files and experiments.
- Automated suggestions may be plausible but wrong.
- Teams need agreement on when intent changes deserve review.
- Can create false positives, review churn, and maintenance work if rules, ignores, and anchors drift apart.

## Review Feedback

The reviewer found the CI direction plausible as an explanation-coverage check, especially because the session shows the workflow end to end. They recommended making policies clearly optional instead of implied defaults, labeling `ydk propose-anchor` as speculative behavior, and being more explicit about operational costs like false positives and review churn.
