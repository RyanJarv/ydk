import assert from "node:assert/strict";
import test from "node:test";
import { allTracesToRoot, traceToRoot } from "../src/graph/trace.ts";
import type { GraphConfig } from "../src/graph/types.ts";

const multiParentGraph: GraphConfig = {
  version: 1,
  nodes: [
    { id: "M-001", type: "mission", title: "Mission" },
    { id: "O-001", type: "outcome", title: "First outcome" },
    { id: "O-002", type: "outcome", title: "Second outcome" },
    { id: "C-001", type: "capability", title: "Capability" },
    { id: "F-001", type: "feature", title: "Feature" },
    { id: "F-002", type: "feature", title: "Disconnected feature" },
  ],
  edges: [
    { from: "F-001", to: "C-001", type: "supports" },
    { from: "F-001", to: "O-002", type: "supports" },
    { from: "C-001", to: "O-001", type: "supports" },
    { from: "C-001", to: "O-002", type: "supports" },
    { from: "O-001", to: "M-001", type: "supports" },
    { from: "O-002", to: "M-001", type: "supports" },
  ],
};

function traceIds(graph: GraphConfig, startId: string, limit?: number): string[][] {
  return (allTracesToRoot(graph, startId, limit) ?? []).map((trace) => trace.map((step) => step.node.id));
}

test("returns every simple path to the mission, shortest first", () => {
  assert.deepEqual(traceIds(multiParentGraph, "F-001"), [
    ["F-001", "O-002", "M-001"],
    ["F-001", "C-001", "O-001", "M-001"],
    ["F-001", "C-001", "O-002", "M-001"],
  ]);
});

test("labels each step after the first with the edge it followed", () => {
  const traces = allTracesToRoot(multiParentGraph, "F-001");

  assert.ok(traces);
  const [first] = traces;
  assert.ok(first);
  assert.equal(first[0]?.via, undefined);
  assert.deepEqual(first[1]?.via, { from: "F-001", to: "O-002", type: "supports" });
  assert.deepEqual(first[2]?.via, { from: "O-002", to: "M-001", type: "supports" });
});

test("caps the number of returned paths with the limit", () => {
  assert.deepEqual(traceIds(multiParentGraph, "F-001", 2), [
    ["F-001", "O-002", "M-001"],
    ["F-001", "C-001", "O-001", "M-001"],
  ]);
});

test("returns the same first path as traceToRoot", () => {
  for (const node of multiParentGraph.nodes) {
    const traces = allTracesToRoot(multiParentGraph, node.id);
    assert.deepEqual(traces?.[0] ?? null, traceToRoot(multiParentGraph, node.id));
  }
});

test("traces a mission node to itself", () => {
  assert.deepEqual(traceIds(multiParentGraph, "M-001"), [["M-001"]]);
});

test("returns null for unknown and disconnected nodes", () => {
  assert.equal(allTracesToRoot(multiParentGraph, "F-404"), null);
  assert.equal(allTracesToRoot(multiParentGraph, "F-002"), null);
});

test("stops at repeated nodes when the graph contains a cycle", () => {
  const cyclicGraph: GraphConfig = {
    version: 1,
    nodes: [
      { id: "M-001", type: "mission", title: "Mission" },
      { id: "C-001", type: "capability", title: "First capability" },
      { id: "C-002", type: "capability", title: "Second capability" },
      { id: "F-001", type: "feature", title: "Feature" },
    ],
    edges: [
      { from: "F-001", to: "C-001", type: "supports" },
      { from: "C-001", to: "C-002", type: "supports" },
      { from: "C-002", to: "C-001", type: "supports" },
      { from: "C-001", to: "M-001", type: "supports" },
    ],
  };

  assert.deepEqual(traceIds(cyclicGraph, "F-001"), [["F-001", "C-001", "M-001"]]);
});
