import assert from "node:assert/strict";
import test from "node:test";
import { loadProject } from "../src/graph/loadProject.js";
import { resolveWhy } from "../src/graph/resolveWhy.js";
import { traceToRoot } from "../src/graph/trace.js";
import { validateProject } from "../src/graph/validateProject.js";

test("validates the repository's ydk configuration", async () => {
  const project = await loadProject();
  const result = validateProject(project);

  assert.deepEqual(result, {
    ok: true,
    errors: [],
  });
});

test("resolves a file to an explanation path ending at the mission", async () => {
  const project = await loadProject();
  const result = resolveWhy(project, "src/cli.ts");

  assert.ok(result);
  assert.equal(result.anchor.node, "F-001");
  assert.equal(result.trace.at(-1)?.node.id, "M-001");
});

test("traces graph nodes to the configured root", async () => {
  const project = await loadProject();
  const trace = traceToRoot(project.graph, project.model, "D-002");

  assert.ok(trace);
  assert.deepEqual(
    trace.map((step) => step.node.id),
    ["D-002", "C-001", "O-001", "M-001"],
  );
});
