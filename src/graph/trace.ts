import type { GraphConfig, GraphEdge, GraphNode, NodeId, TraceStep } from "./types.js";

export function traceToRoot(graph: GraphConfig, startId: NodeId): TraceStep[] | null {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<NodeId, GraphEdge[]>();

  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.from) ?? [];
    edges.push(edge);
    outgoing.set(edge.from, edges);
  }

  const start = nodes.get(startId);
  if (!start) {
    return null;
  }

  const queue: Array<{ node: GraphNode; path: TraceStep[] }> = [
    { node: start, path: [{ node: start }] },
  ];
  const visited = new Set<NodeId>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (current.node.type === "mission") {
      return current.path;
    }

    if (visited.has(current.node.id)) {
      continue;
    }
    visited.add(current.node.id);

    for (const edge of outgoing.get(current.node.id) ?? []) {
      const next = nodes.get(edge.to);
      if (next) {
        queue.push({
          node: next,
          path: [...current.path, { node: next, via: edge }],
        });
      }
    }
  }

  return null;
}
