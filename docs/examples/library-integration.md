# Library Integration

## Approach

This direction treats `ydk` as a library or model format consumed by another tool. The user may never run `ydk` directly. Instead, an IDE extension, documentation generator, PR bot, or architecture dashboard loads the model and uses it to add purpose context.

This is useful when terminal session logs are not the primary interface.

## Example Code

```ts
import { loadProject, resolveWhy } from "ydk";

export async function provideHover(documentPath: string) {
  const project = await loadProject("/work/ydk");
  const result = resolveWhy(project, documentPath);

  if (!result) {
    return null;
  }

  return renderHover({
    title: result.anchor.target.path,
    summary: result.anchor.reason,
    trace: result.trace.map((step) => ({
      id: step.node.id,
      type: step.node.type,
      title: step.node.title,
    })),
  });
}
```

## Session Log

```console
# IDE extension activation calls the ydk library directly.
extension.activate(workspace="/work/ydk")
  project = await loadProject("/work/ydk")
  registerHoverProvider("file", provideHover)
  registerPanel("ydk.purposeGraph", renderPurposePanel)

# The user hovers over src/cli.ts in the file explorer.
hoverProvider.onHover(documentPath="src/cli.ts")
  result = resolveWhy(project, "src/cli.ts")
  return HoverCard(
    title="src/cli.ts",
    summary="Provides the command interface for asking why an artifact exists.",
    trace=[
      "F-001 Explain why a repo artifact exists",
      "C-001 Resolve implementation artifacts to project intent",
      "O-001 Maintainers can answer why a feature exists",
      "M-001 Help maintainers understand why code exists"
    ]
  )

# The user opens the extension panel.
panel.render(selectedArtifact="src/cli.ts")
  selectedNode = "F-001"
  actions = ["Show impacted artifacts", "Copy explanation", "Create missing anchor"]

# In a pull request, a bot uses the same library API inside a webhook handler.
webhook.pull_request.opened(files=["src/format/json.ts", "src/cli.ts"])
  project = await loadProject(checkoutPath)
  diagnostics = reviewChangedFiles(project, files)
  postComment("""
  Purpose review summary

  src/format/json.ts is new and has no purpose anchor.
  Nearby anchored file src/cli.ts maps to F-001.

  Suggested action:
    Add an anchor or mark this path ignored in CI policy.
  """)
```

## Behavior Notes

Library integration depends on a stable public API more than CLI polish. The useful API surface is small:

```ts
loadProject(root): Promise<YdkProject>
validateProject(project): ValidationResult
resolveWhy(project, target): WhyResult | null
traceToRoot(graph, nodeId): TraceStep[] | null
```

Other tools should not need to understand YAML details directly. They should consume a normalized model with typed nodes, edges, anchors, and validation diagnostics.

The graph and anchor files are the portable data contract. If the format is clear, other tools can consume the graph without depending on the official CLI.

## Pros and Cons

Pros:

- Makes `ydk` useful where developers already work.
- Supports IDEs, PR bots, dashboards, and documentation tools.
- Avoids requiring every user to learn a new CLI.
- Encourages a stable model format and library API.

Cons:

- Requires stronger compatibility guarantees.
- More consumers means format migrations become harder.
- UI integrations can hide important ambiguity behind polished surfaces.
- The library API may constrain experimentation with the config format.

## Review Feedback

The reviewer found the integration direction clear but wanted a stronger boundary between CLI usage and API/plugin usage. The example was revised to show an IDE activation, hover provider, panel render, and PR webhook handler calling the library directly rather than presenting a mostly terminal-centered flow.
