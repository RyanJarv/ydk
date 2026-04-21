import path from "node:path";
import { traceToRoot } from "./trace.js";
import type { Anchor, TraceStep, YdkProject } from "./types.js";

export type WhyResult = {
  anchor: Anchor;
  trace: TraceStep[];
  matchedPattern?: string;
};

function normalizeTarget(target: string): string {
  return target.split(path.sep).join("/");
}

export function resolveWhy(project: YdkProject, target: string): WhyResult | null {
  const normalizedTarget = normalizeTarget(target);
  const exactAnchor = project.anchors.anchors.find(
    (candidate) => candidate.target.kind !== "filePattern" && candidate.target.path === normalizedTarget,
  );
  const patternAnchor = exactAnchor
    ? undefined
    : project.anchors.anchors.find(
        (candidate) =>
          candidate.target.kind === "filePattern" &&
          matchesPattern(normalizedTarget, candidate.target.path),
      );
  const anchor = exactAnchor ?? patternAnchor;

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
    matchedPattern: patternAnchor?.target.path,
  };
}

function matchesPattern(target: string, pattern: string): boolean {
  return globToRegExp(normalizeTarget(pattern)).test(target);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string | undefined): string {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
