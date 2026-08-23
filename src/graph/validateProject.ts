import { ANCHORABLE_NODE_TYPES } from "./coverage.ts";
import { createTargetResolver, formatAnchorTarget } from "./targetResolver.ts";
import { traceToRoot } from "./trace.ts";
import type { GraphEdge, GraphNode, NodeId, YdkProject } from "./types.ts";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

const ALLOWED_NODE_TYPES = new Set(["mission", "outcome", "capability", "feature"]);
const ALLOWED_EDGE_TYPES = new Set(["supports"]);
const MIN_SCORE = 0;
const MAX_SCORE = 4;
const ASSESSED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

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

function isValidScore(score: unknown): boolean {
  return typeof score === "number" && Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE;
}

function isValidAssessedDate(assessed: unknown): boolean {
  if (typeof assessed !== "string" || !ASSESSED_DATE_PATTERN.test(assessed)) {
    return false;
  }

  // A well-shaped date can still name no real day, which Date rolls over rather than rejects.
  const parsed = Date.parse(assessed);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(assessed);
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
  const resolver = createTargetResolver(project);
  const nodes = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const duplicateIds = findDuplicateIds(project.graph.nodes);

  for (const id of duplicateIds) {
    errors.push(`Duplicate node id: ${id}`);
  }

  for (const node of project.graph.nodes) {
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      errors.push(`Node ${node.id} uses unknown type: ${node.type}`);
    }
  }

  const missionNodes = project.graph.nodes.filter((node) => node.type === "mission");
  if (missionNodes.length !== 1) {
    errors.push(`Expected exactly one mission node, found ${missionNodes.length}`);
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

    if (!ALLOWED_EDGE_TYPES.has(edge.type)) {
      errors.push(`Edge ${edge.from} -> ${edge.to} uses unknown type: ${edge.type}`);
    }

    if (from.type === "mission") {
      errors.push(`Mission node should not support another node: ${edge.from} -> ${edge.to}`);
    }
  }

  if (hasCycle(project.graph.edges)) {
    errors.push("Graph contains a cycle");
  }

  for (const node of project.graph.nodes) {
    if (!traceToRoot(project.graph, node.id)) {
      errors.push(`Node does not reach the mission: ${node.id}`);
    }
  }

  for (const anchor of project.anchors.anchors) {
    if (!nodes.has(anchor.node)) {
      errors.push(`Anchor ${formatAnchorTarget(anchor)} references unknown node: ${anchor.node}`);
    }
  }

  const assessedNodes = new Set<NodeId>();
  for (const assessment of project.assessments.assessments) {
    const node = nodes.get(assessment.node);

    if (!node) {
      errors.push(`Assessment references unknown node: ${assessment.node}`);
    } else if (!ANCHORABLE_NODE_TYPES.has(node.type)) {
      errors.push(`Assessment ${assessment.node} uses non-anchorable node type: ${node.type}`);
    }

    if (!isValidScore(assessment.score)) {
      errors.push(`Assessment ${assessment.node} has invalid score: ${JSON.stringify(assessment.score)}`);
    }

    if (!isValidAssessedDate(assessment.assessed)) {
      errors.push(
        `Assessment ${assessment.node} has invalid assessed date: ${JSON.stringify(assessment.assessed)}`,
      );
    }

    if (assessedNodes.has(assessment.node)) {
      errors.push(`Duplicate assessment for node: ${assessment.node}`);
    }
    assessedNodes.add(assessment.node);
  }

  errors.push(...resolver.validate());

  return {
    ok: errors.length === 0,
    errors,
  };
}
