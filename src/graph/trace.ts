import type { GraphConfig, GraphEdge, GraphNode, NodeId, TraceStep } from "./types.ts";

function outgoingEdges(graph: GraphConfig): Map<NodeId, GraphEdge[]> {
  const outgoing = new Map<NodeId, GraphEdge[]>();

  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.from) ?? [];
    edges.push(edge);
    outgoing.set(edge.from, edges);
  }

  return outgoing;
}

export function allTracesToRoot(
  graph: GraphConfig,
  startId: NodeId,
  limit?: number,
): TraceStep[][] | null {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = outgoingEdges(graph);
  const start = nodes.get(startId);

  if (!start) {
    return null;
  }

  const maxPaths = limit ?? Number.POSITIVE_INFINITY;
  const traces: TraceStep[][] = [];
  const queue: Array<{ node: GraphNode; path: TraceStep[]; seen: Set<NodeId> }> = [
    { node: start, path: [{ node: start }], seen: new Set([start.id]) },
  ];

  while (queue.length > 0 && traces.length < maxPaths) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (current.node.type === "mission") {
      traces.push(current.path);
      continue;
    }

    for (const edge of outgoing.get(current.node.id) ?? []) {
      const next = nodes.get(edge.to);
      if (!next || current.seen.has(next.id)) {
        continue;
      }

      queue.push({
        node: next,
        path: [...current.path, { node: next, via: edge }],
        seen: new Set(current.seen).add(next.id),
      });
    }
  }

  return traces.length > 0 ? traces : null;
}

export function traceToRoot(graph: GraphConfig, startId: NodeId): TraceStep[] | null {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = outgoingEdges(graph);

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
