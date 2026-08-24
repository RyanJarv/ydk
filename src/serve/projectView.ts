import {
  computeAnchorStatus,
  computeCoverage,
  listProjectFiles,
  type CoverageReport,
} from "../graph/coverage.ts";
import { resolveWhy } from "../graph/resolveWhy.ts";
import { formatAnchorTarget } from "../graph/targetResolver.ts";
import { allTracesToRoot } from "../graph/trace.ts";
import type { Anchor, Assessment, GraphNode, NodeId, YdkProject } from "../graph/types.ts";

export type ProjectViewAnchor = {
  display: string;
  kind: string;
  reason: string;
  matchCount?: number;
  stale?: boolean;
};

export type ProjectViewAssessment = {
  score: number;
  assessed: string;
  unfulfilled: string[];
  undeclared: string[];
};

export type ProjectViewNode = GraphNode & {
  anchors: ProjectViewAnchor[];
  trace: string[];
  traces: string[][];
  assessment?: ProjectViewAssessment;
};

export type WhyView = {
  query: string;
  anchor: {
    display: string;
    kind: string;
    reason: string;
    node: NodeId;
  };
  trace: NodeId[];
};

export type ProjectView = {
  nodes: ProjectViewNode[];
  edges: YdkProject["graph"]["edges"];
  anchors: Array<
    ProjectViewAnchor & {
      node: NodeId;
      nodeTitle: string;
    }
  >;
  stats: {
    nodeCount: number;
    edgeCount: number;
    anchorCount: number;
    anchorableNodeCount: number;
    anchoredNodeCount: number;
  };
  coverage: CoverageReport;
};

export function createProjectView(project: YdkProject): ProjectView {
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const anchorsByNode = new Map<NodeId, Anchor[]>();
  const files = listProjectFiles(project);
  const coverage = computeCoverage(project, files);

  for (const anchor of project.anchors.anchors) {
    const anchors = anchorsByNode.get(anchor.node) ?? [];
    anchors.push(anchor);
    anchorsByNode.set(anchor.node, anchors);
  }

  const assessmentByNode = new Map<NodeId, Assessment>();
  for (const assessment of project.assessments.assessments) {
    if (!assessmentByNode.has(assessment.node)) {
      assessmentByNode.set(assessment.node, assessment);
    }
  }

  const anchorViews = new Map<Anchor, ProjectViewAnchor>(
    project.anchors.anchors.map((anchor) => {
      const status = computeAnchorStatus(project, anchor, files);
      return [
        anchor,
        {
          display: formatAnchorTarget(anchor),
          kind: anchor.target.kind,
          reason: anchor.reason,
          ...(status.matchCount === undefined ? {} : { matchCount: status.matchCount }),
          stale: status.stale === true,
        },
      ];
    }),
  );

  const nodes = project.graph.nodes.map((node) => {
    const traces = (allTracesToRoot(project.graph, node.id) ?? []).map((trace) =>
      trace.map((step) => step.node.id),
    );
    const assessment = assessmentByNode.get(node.id);

    return {
      ...node,
      anchors: (anchorsByNode.get(node.id) ?? []).map((anchor) => anchorView(anchorViews, anchor)),
      trace: traces[0] ?? [],
      traces,
      ...(assessment ? { assessment: assessmentView(assessment) } : {}),
    };
  });

  const anchors = project.anchors.anchors.map((anchor) => ({
    ...anchorView(anchorViews, anchor),
    node: anchor.node,
    nodeTitle: nodeById.get(anchor.node)?.title ?? "Unknown node",
  }));

  return {
    nodes,
    edges: project.graph.edges,
    anchors,
    stats: {
      nodeCount: project.graph.nodes.length,
      edgeCount: project.graph.edges.length,
      anchorCount: project.anchors.anchors.length,
      anchorableNodeCount: coverage.anchorableNodeCount,
      anchoredNodeCount: coverage.anchoredNodeCount,
    },
    coverage,
  };
}

/**
 * Answers an arbitrary repo path the way `ydk why` does, so the browser and the
 * terminal resolve a query through the same anchor and the same trace.
 */
export function createWhyView(project: YdkProject, query: string): WhyView | null {
  const result = resolveWhy(project, query);
  if (!result) {
    return null;
  }

  return {
    query,
    anchor: {
      display: result.displayTarget,
      kind: result.anchor.target.kind,
      reason: result.anchor.reason,
      node: result.anchor.node,
    },
    trace: result.trace.map((step) => step.node.id),
  };
}

function assessmentView(assessment: Assessment): ProjectViewAssessment {
  return {
    score: assessment.score,
    assessed: assessment.assessed,
    unfulfilled: assessment.unfulfilled ?? [],
    undeclared: assessment.undeclared ?? [],
  };
}

function anchorView(anchorViews: Map<Anchor, ProjectViewAnchor>, anchor: Anchor): ProjectViewAnchor {
  return (
    anchorViews.get(anchor) ?? {
      display: formatAnchorTarget(anchor),
      kind: anchor.target.kind,
      reason: anchor.reason,
      stale: false,
    }
  );
}
