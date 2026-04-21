import path from "node:path";
import { traceToRoot } from "./trace.js";
import type { Anchor, TraceStep, YdkProject } from "./types.js";

export type WhyResult = {
  anchor: Anchor;
  trace: TraceStep[];
};

function normalizeTarget(target: string): string {
  return target.split(path.sep).join("/");
}

export function resolveWhy(project: YdkProject, target: string): WhyResult | null {
  const normalizedTarget = normalizeTarget(target);
  const anchor = project.anchors.anchors.find((candidate) => candidate.target.path === normalizedTarget);

  if (!anchor) {
    return null;
  }

  const trace = traceToRoot(project.graph, project.model, anchor.node);
  if (!trace) {
    return null;
  }

  return {
    anchor,
    trace,
  };
}
