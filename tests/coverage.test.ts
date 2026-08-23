import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeAnchorStatus, computeCoverage, listProjectFiles } from "../src/graph/coverage.ts";
import type { Anchor, Assessment, YdkProject } from "../src/graph/types.ts";

const packageJson = JSON.stringify(
  {
    name: "temp-project",
    version: "1.0.0",
    scripts: {
      build: "tsc",
    },
  },
  null,
  2,
);

async function createTempRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-coverage-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  return root;
}

function createProject(root: string, anchors: Anchor[], assessments: Assessment[] = []): YdkProject {
  return {
    root,
    graph: {
      version: 1,
      nodes: [
        { id: "M-001", type: "mission", title: "Mission" },
        { id: "O-001", type: "outcome", title: "Outcome" },
        { id: "C-001", type: "capability", title: "Capability" },
        { id: "F-001", type: "feature", title: "First feature" },
        { id: "F-002", type: "feature", title: "Second feature" },
      ],
      edges: [
        { from: "O-001", to: "M-001", type: "supports" },
        { from: "C-001", to: "O-001", type: "supports" },
        { from: "F-001", to: "C-001", type: "supports" },
        { from: "F-002", to: "C-001", type: "supports" },
      ],
    },
    anchors: {
      version: 1,
      anchors,
    },
    assessments: {
      version: 1,
      assessments,
    },
  };
}

test("counts anchored files across file, pattern, directory, and package script anchors", async () => {
  const root = await createTempRoot({
    "package.json": packageJson,
    "README.md": "# Temp project\n",
    "src/cli.ts": "export {};\n",
    "src/graph/trace.ts": "export {};\n",
    "src/graph/types.ts": "export {};\n",
    "docs/guide.md": "# Guide\n",
    "docs/notes/todo.md": "# Todo\n",
  });
  const project = createProject(root, [
    { target: { kind: "file", value: "README.md" }, node: "F-001", reason: "Introduces the project." },
    { target: { kind: "filePattern", value: "src/graph/*.ts" }, node: "C-001", reason: "Holds the graph model." },
    { target: { kind: "directory", value: "docs" }, node: "C-001", reason: "Documents the model." },
    {
      target: { kind: "packageScript", value: { path: "package.json", script: "build" } },
      node: "F-001",
      reason: "Builds the project.",
    },
  ]);

  const coverage = computeCoverage(project);

  assert.equal(coverage.totalFiles, 7);
  assert.equal(coverage.anchoredFiles, 6);
  assert.deepEqual(coverage.staleAnchors, []);
  assert.deepEqual(coverage.directories, [
    { path: ".", totalFiles: 2, anchoredFiles: 2, children: [] },
    {
      path: "docs/",
      totalFiles: 2,
      anchoredFiles: 2,
      children: [{ path: "docs/notes/", totalFiles: 1, anchoredFiles: 1, children: [] }],
    },
    {
      path: "src/",
      totalFiles: 3,
      anchoredFiles: 2,
      children: [{ path: "src/graph/", totalFiles: 2, anchoredFiles: 2, children: [] }],
    },
  ]);
});

test("reports anchorable nodes that have no anchors", async () => {
  const root = await createTempRoot({ "src/cli.ts": "export {};\n" });
  const project = createProject(root, [
    { target: { kind: "file", value: "src/cli.ts" }, node: "F-001", reason: "Runs the CLI." },
    { target: { kind: "file", value: "src/cli.ts" }, node: "O-001", reason: "Serves the outcome." },
  ]);

  const coverage = computeCoverage(project);

  assert.equal(coverage.anchorableNodeCount, 3);
  assert.equal(coverage.anchoredNodeCount, 1);
  assert.deepEqual(coverage.unanchoredNodes, [
    { id: "C-001", type: "capability", title: "Capability" },
    { id: "F-002", type: "feature", title: "Second feature" },
  ]);
  assert.equal(coverage.anchoredFiles, 1);
});

test("flags anchors whose targets no longer exist", async () => {
  const root = await createTempRoot({
    "package.json": packageJson,
    "src/cli.ts": "export {};\n",
  });
  const project = createProject(root, [
    { target: { kind: "file", value: "src/cli.ts" }, node: "F-001", reason: "Runs the CLI." },
    { target: { kind: "file", value: "missing.txt" }, node: "F-001", reason: "Missing file." },
    { target: { kind: "directory", value: "generated" }, node: "C-001", reason: "Missing directory." },
    { target: { kind: "filePattern", value: "tests/*.test.ts" }, node: "F-002", reason: "Missing tests." },
    {
      target: { kind: "packageScript", value: { path: "package.json", script: "deploy" } },
      node: "F-001",
      reason: "Missing script.",
    },
    {
      target: { kind: "packageScript", value: { path: "tools/package.json", script: "build" } },
      node: "F-001",
      reason: "Missing package file.",
    },
  ]);

  const coverage = computeCoverage(project);

  assert.deepEqual(coverage.staleAnchors, [
    { display: "missing.txt", node: "F-001", reason: "file not found" },
    { display: "generated", node: "C-001", reason: "directory not found" },
    { display: "tests/*.test.ts", node: "F-002", reason: "pattern matches no files" },
    { display: "package.json#deploy", node: "F-001", reason: "package script not found" },
    { display: "tools/package.json#build", node: "F-001", reason: "package file not found" },
  ]);
});

test("anchors a node with a url without counting it toward file coverage", async () => {
  const root = await createTempRoot({
    "README.md": "# Temp project\n",
    "src/cli.ts": "export {};\n",
  });
  const project = createProject(root, [
    { target: { kind: "file", value: "README.md" }, node: "F-001", reason: "Introduces the project." },
    { target: { kind: "url", value: "/#/map" }, node: "F-002", reason: "Presents the project map." },
    { target: { kind: "url", value: "https://ydk.example/docs" }, node: "C-001", reason: "Hosts the guide." },
  ]);

  const coverage = computeCoverage(project);

  assert.equal(coverage.anchoredNodeCount, 3);
  assert.deepEqual(coverage.unanchoredNodes, []);
  assert.equal(coverage.totalFiles, 2);
  assert.equal(coverage.anchoredFiles, 1);
  assert.deepEqual(coverage.staleAnchors, []);
  assert.deepEqual(coverage.directories, [
    { path: ".", totalFiles: 1, anchoredFiles: 1, children: [] },
    { path: "src/", totalFiles: 1, anchoredFiles: 0, children: [] },
  ]);
});

test("never reports a url anchor as stale", async () => {
  const root = await createTempRoot({ "src/cli.ts": "export {};\n" });
  const project = createProject(root, []);
  const anchor: Anchor = {
    target: { kind: "url", value: "/#/map" },
    node: "F-002",
    reason: "Presents the project map.",
  };

  assert.deepEqual(computeAnchorStatus(project, anchor, listProjectFiles(project)), {});
});

test("skips files matched by .ydk/ignore patterns", async () => {
  const root = await createTempRoot({
    ".ydk/ignore": "# build output\n\ndist/**\n*.log\n",
    "dist/bundle.js": "console.log(1);\n",
    "debug.log": "noise\n",
    "src/cli.ts": "export {};\n",
  });
  const project = createProject(root, [
    { target: { kind: "filePattern", value: "dist/**" }, node: "F-001", reason: "Ships the bundle." },
  ]);

  assert.deepEqual(listProjectFiles(project), ["src/cli.ts"]);

  const coverage = computeCoverage(project);

  assert.equal(coverage.totalFiles, 1);
  assert.equal(coverage.anchoredFiles, 0);
  assert.deepEqual(
    coverage.directories.map((directory) => directory.path),
    ["src/"],
  );
  assert.deepEqual(coverage.staleAnchors, [
    { display: "dist/**", node: "F-001", reason: "pattern matches no files" },
  ]);
});

test("counts a file matched by several anchors once", async () => {
  const root = await createTempRoot({ "src/graph/trace.ts": "export {};\n" });
  const project = createProject(root, [
    { target: { kind: "file", value: "src/graph/trace.ts" }, node: "F-001", reason: "Walks the graph." },
    { target: { kind: "directory", value: "src" }, node: "C-001", reason: "Holds the implementation." },
    { target: { kind: "filePattern", value: "src/**" }, node: "C-001", reason: "Covers the implementation." },
  ]);

  const coverage = computeCoverage(project);

  assert.equal(coverage.totalFiles, 1);
  assert.equal(coverage.anchoredFiles, 1);
});

test("reports assessed nodes in graph order with their average score", async () => {
  const root = await createTempRoot({ "src/cli.ts": "export {};\n" });
  const project = createProject(
    root,
    [{ target: { kind: "file", value: "src/cli.ts" }, node: "F-001", reason: "Runs the CLI." }],
    [
      { node: "F-001", score: 2, assessed: "2026-08-23", unfulfilled: ["No JSON output."] },
      { node: "C-001", score: 3, assessed: "2026-08-20" },
    ],
  );

  const coverage = computeCoverage(project);

  assert.deepEqual(coverage.assessedNodes, [
    { id: "C-001", type: "capability", title: "Capability", score: 3, assessed: "2026-08-20" },
    { id: "F-001", type: "feature", title: "First feature", score: 2, assessed: "2026-08-23" },
  ]);
  assert.equal(coverage.averageScore, 2.5);
});

test("reports no assessed nodes when the project has no assessments", async () => {
  const root = await createTempRoot({ "src/cli.ts": "export {};\n" });
  const coverage = computeCoverage(createProject(root, []));

  assert.deepEqual(coverage.assessedNodes, []);
  assert.equal(coverage.averageScore, null);
});

test("leaves an assessment of an unknown node out of the coverage report", async () => {
  const root = await createTempRoot({ "src/cli.ts": "export {};\n" });
  const project = createProject(root, [], [{ node: "F-404", score: 4, assessed: "2026-08-23" }]);

  assert.deepEqual(computeCoverage(project).assessedNodes, []);
});

test("excludes .git, node_modules, and .ydk from the file walk", async () => {
  const root = await createTempRoot({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".ydk/graph.yaml": "version: 1\n",
    "node_modules/left-pad/index.js": "module.exports = 1;\n",
    "src/cli.ts": "export {};\n",
  });

  assert.deepEqual(listProjectFiles(createProject(root, [])), ["src/cli.ts"]);
});
