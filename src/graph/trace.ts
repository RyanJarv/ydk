import type { GraphConfig, GraphEdge, GraphNode, ModelConfig, NodeId, TraceStep } from "./types.js";

function rootTypes(model: ModelConfig): Set<string> {
  return new Set(
    Object.entries(model.model.nodeTypes)
      .filter(([, definition]) => definition.root)
      .map(([type]) => type),
  );
}

export function traceToRoot(graph: GraphConfig, model: ModelConfig, startId: NodeId): TraceStep[] | null {
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

  const roots = rootTypes(model);
  const queue: Array<{ node: GraphNode; path: TraceStep[] }> = [
    { node: start, path: [{ node: start }] },
  ];
  const visited = new Set<NodeId>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (roots.has(current.node.type)) {
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
