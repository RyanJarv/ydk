import { createTargetResolver, formatAnchorTarget } from "../graph/targetResolver.js";
import { traceToRoot } from "../graph/trace.js";
import type { Anchor, GraphNode, NodeId, YdkProject } from "../graph/types.js";

export type ProjectViewNode = GraphNode & {
  anchors: Array<{
    display: string;
    kind: string;
    reason: string;
  }>;
  trace: string[];
};

export type ProjectView = {
  nodes: ProjectViewNode[];
  edges: YdkProject["graph"]["edges"];
  anchors: Array<{
    display: string;
    kind: string;
    node: NodeId;
    nodeTitle: string;
    reason: string;
  }>;
  stats: {
    nodeCount: number;
    edgeCount: number;
    anchorCount: number;
    anchoredNodeCount: number;
  };
};

export function createProjectView(project: YdkProject): ProjectView {
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const anchorsByNode = new Map<NodeId, Anchor[]>();
  const targetResolver = createTargetResolver(project);

  for (const anchor of project.anchors.anchors) {
    const anchors = anchorsByNode.get(anchor.node) ?? [];
    anchors.push(anchor);
    anchorsByNode.set(anchor.node, anchors);
  }

  const nodes = project.graph.nodes.map((node) => {
    const trace = traceToRoot(project.graph, node.id) ?? [];
    return {
      ...node,
      anchors: (anchorsByNode.get(node.id) ?? []).map((anchor) => ({
        display: formatAnchorTarget(anchor),
        kind: anchor.target.kind,
        reason: anchor.reason,
      })),
      trace: trace.map((step) => step.node.id),
    };
  });

  const anchors = project.anchors.anchors.map((anchor) => ({
    display: formatAnchorTarget(anchor),
    kind: anchor.target.kind,
    node: anchor.node,
    nodeTitle: nodeById.get(anchor.node)?.title ?? "Unknown node",
    reason: anchor.reason,
  }));

  return {
    nodes,
    edges: project.graph.edges,
    anchors,
    stats: {
      nodeCount: project.graph.nodes.length,
      edgeCount: project.graph.edges.length,
      anchorCount: project.anchors.anchors.length,
      anchoredNodeCount: anchorsByNode.size,
    },
  };
}
