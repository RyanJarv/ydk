import { createTargetResolver } from "./targetResolver.js";
import { traceToRoot } from "./trace.js";
import type { Anchor, TraceStep, YdkProject } from "./types.js";

export type WhyResult = {
  anchor: Anchor;
  displayTarget: string;
  trace: TraceStep[];
  matchedPattern?: string;
};

export function resolveWhy(project: YdkProject, target: string): WhyResult | null {
  const resolver = createTargetResolver(project);
  const result = resolver.resolve(target);
  if (!result) {
    return null;
  }

  const trace = traceToRoot(project.graph, result.anchor.node);
  if (!trace) {
    return null;
  }

  return {
    anchor: result.anchor,
    displayTarget: result.display,
    trace,
    matchedPattern: result.matchedPattern,
  };
}
