import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProject } from "../src/graph/loadProject.js";
import { resolveWhy } from "../src/graph/resolveWhy.js";
import { traceToRoot } from "../src/graph/trace.js";
import { validateProject } from "../src/graph/validateProject.js";

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-target-resolver-"));
  await mkdir(path.join(root, "generated"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "temp-project",
        version: "1.0.0",
        scripts: {
          build: "tsc",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return root;
}

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

test("prefers an exact file anchor over a matching pattern anchor", async () => {
  const project = await loadProject();
  project.anchors.anchors.unshift({
    target: {
      kind: "filePattern",
      value: "src/*.ts",
    },
    node: "F-002",
    reason: "Covers TypeScript files under src.",
  });

  const result = resolveWhy(project, "src/cli.ts");

  assert.ok(result);
  assert.equal(result.anchor.node, "F-001");
  assert.equal(result.matchedPattern, undefined);
});

test("resolves a file using a pattern anchor", async () => {
  const project = await loadProject();
  project.anchors.anchors.push({
    target: {
      kind: "filePattern",
      value: ".pit/prompts/*.yaml",
    },
    node: "F-001",
    reason: "Stores prompt snapshots produced by pit.",
  });

  const result = resolveWhy(project, ".pit/prompts/P-0001.yaml");

  assert.ok(result);
  assert.equal(result.anchor.node, "F-001");
  assert.equal(result.matchedPattern, ".pit/prompts/*.yaml");
  assert.equal(result.trace.at(-1)?.node.id, "M-001");
});

test("resolves a directory anchor for files inside the directory", async () => {
  const project = await loadProject();
  project.anchors.anchors = [
    {
      target: {
        kind: "directory",
        value: "docs/examples",
      },
      node: "F-002",
      reason: "Covers the example direction documents.",
    },
  ];

  const result = resolveWhy(project, "docs/examples/library-integration.md");

  assert.ok(result);
  assert.equal(result.anchor.node, "F-002");
  assert.equal(result.trace.at(-1)?.node.id, "M-001");
});

test("resolves a package script anchor", async () => {
  const project = await loadProject();
  const root = await createTempProject();
  project.root = root;
  project.anchors.anchors = [
    {
      target: {
        kind: "packageScript",
        value: {
          path: "package.json",
          script: "build",
        },
      },
      node: "F-001",
      reason: "Builds the repository before release.",
    },
  ];

  const result = resolveWhy(project, "package.json#build");

  assert.ok(result);
  assert.equal(result.anchor.node, "F-001");
  assert.equal(result.displayTarget, "package.json#build");
  assert.equal(result.trace.at(-1)?.node.id, "M-001");
});

test("validates that concrete anchors reference existing files, directories, and scripts", async () => {
  const project = await loadProject();
  const root = await createTempProject();
  project.root = root;
  project.graph = {
    version: 1,
    nodes: [
      { id: "M-001", type: "mission", title: "Mission" },
      { id: "F-001", type: "feature", title: "Feature" },
    ],
    edges: [{ from: "F-001", to: "M-001", type: "supports" }],
  };
  project.anchors.anchors = [
    {
      target: {
        kind: "file",
        value: "missing.txt",
      },
      node: "F-001",
      reason: "Missing file anchor.",
    },
    {
      target: {
        kind: "directory",
        value: "generated",
      },
      node: "F-001",
      reason: "Directory anchor.",
    },
    {
      target: {
        kind: "packageScript",
        value: {
          path: "package.json",
          script: "test",
        },
      },
      node: "F-001",
      reason: "Missing package script anchor.",
    },
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("Anchor missing.txt references missing file: missing.txt"));
  assert.ok(
    result.errors.includes("Anchor package.json#test references missing package script: package.json#test"),
  );
  assert.ok(!result.errors.some((error) => error.includes("generated")));
});

test("traces graph nodes to the configured root", async () => {
  const project = await loadProject();
  const trace = traceToRoot(project.graph, "F-002");

  assert.ok(trace);
  assert.deepEqual(
    trace.map((step) => step.node.id),
    ["F-002", "C-001", "O-001", "M-001"],
  );
});
