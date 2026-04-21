import { traceToRoot } from "./trace.js";
import type { GraphEdge, GraphNode, ModelConfig, NodeId, YdkProject } from "./types.js";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

function findDuplicateIds(nodes: GraphNode[]): NodeId[] {
  const seen = new Set<NodeId>();
  const duplicates = new Set<NodeId>();

  for (const node of nodes) {
    if (seen.has(node.id)) {
      duplicates.add(node.id);
    }
    seen.add(node.id);
  }

  return [...duplicates];
}

function isAllowedEdge(model: ModelConfig, edge: GraphEdge, from: GraphNode, to: GraphNode): boolean {
  const edgeType = model.model.edgeTypes[edge.type];
  if (!edgeType) {
    return false;
  }

  const allowed = edgeType.allowed ?? [];
  return allowed.some((candidate) => candidate.from === from.type && candidate.to === to.type);
}

function hasCycle(edges: GraphEdge[]): boolean {
  const outgoing = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    const next = outgoing.get(edge.from) ?? [];
    next.push(edge.to);
    outgoing.set(edge.from, next);
  }

  const visiting = new Set<NodeId>();
  const visited = new Set<NodeId>();

  function visit(node: NodeId): boolean {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }

    visiting.add(node);
    for (const next of outgoing.get(node) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  return [...outgoing.keys()].some(visit);
}

export function validateProject(project: YdkProject): ValidationResult {
  const errors: string[] = [];
  const validation = project.model.model.validation ?? {};
  const nodeTypes = project.model.model.nodeTypes;
  const nodes = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const duplicateIds = findDuplicateIds(project.graph.nodes);

  for (const id of duplicateIds) {
    errors.push(`Duplicate node id: ${id}`);
  }

  for (const node of project.graph.nodes) {
    if (!nodeTypes[node.type]) {
      errors.push(`Node ${node.id} uses unknown type: ${node.type}`);
    }
  }

  for (const [type, definition] of Object.entries(nodeTypes)) {
    const matchingNodes = project.graph.nodes.filter((node) => node.type === type);
    if (definition.required && matchingNodes.length === 0) {
      errors.push(`Required node type has no nodes: ${type}`);
    }
    if (definition.maxCount !== undefined && matchingNodes.length > definition.maxCount) {
      errors.push(`Node type ${type} allows at most ${definition.maxCount} node(s), found ${matchingNodes.length}`);
    }
  }

  const rootTypes = new Set(
    Object.entries(nodeTypes)
      .filter(([, definition]) => definition.root)
      .map(([type]) => type),
  );
  const rootNodes = project.graph.nodes.filter((node) => rootTypes.has(node.type));
  if (validation.requireExactlyOneRoot && rootNodes.length !== 1) {
    errors.push(`Expected exactly one root node, found ${rootNodes.length}`);
  }

  for (const edge of project.graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);

    if (!from) {
      errors.push(`Edge ${edge.from} -> ${edge.to} starts at unknown node: ${edge.from}`);
      continue;
    }

    if (!to) {
      errors.push(`Edge ${edge.from} -> ${edge.to} ends at unknown node: ${edge.to}`);
      continue;
    }

    if (!isAllowedEdge(project.model, edge, from, to)) {
      errors.push(`Edge ${edge.from} -> ${edge.to} has invalid type/type pairing: ${edge.type} ${from.type}->${to.type}`);
    }
  }

  if (validation.allowCycles === false && hasCycle(project.graph.edges)) {
    errors.push("Graph contains a cycle");
  }

  if (validation.requireAllNodesReachRoot) {
    for (const node of project.graph.nodes) {
      if (!traceToRoot(project.graph, project.model, node.id)) {
        errors.push(`Node does not reach a root: ${node.id}`);
      }
    }
  }

  if (validation.requireAllAnchorsResolve) {
    for (const anchor of project.anchors.anchors) {
      if (!nodes.has(anchor.node)) {
        errors.push(`Anchor ${anchor.target.path} references unknown node: ${anchor.node}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
