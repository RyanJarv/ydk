import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProject } from "../src/graph/loadProject.ts";
import { resolveWhy } from "../src/graph/resolveWhy.ts";
import { traceToRoot } from "../src/graph/trace.ts";
import { validateProject } from "../src/graph/validateProject.ts";

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

test("resolves a url anchor from every spelling of its route", async () => {
  const project = await loadProject();
  project.anchors.anchors = [
    {
      target: {
        kind: "url",
        value: "/#/map",
      },
      node: "F-002",
      reason: "Presents the graph as a layered project map.",
    },
  ];

  for (const query of ["/#/map", "#/map", "http://127.0.0.1:4173/#/map"]) {
    const result = resolveWhy(project, query);

    assert.ok(result, `expected ${query} to resolve`);
    assert.equal(result.anchor.node, "F-002");
    assert.equal(result.displayTarget, "/#/map");
    assert.equal(result.trace.at(-1)?.node.id, "M-001");
  }
});

test("does not resolve a url anchor from an unrelated route", async () => {
  const project = await loadProject();
  project.anchors.anchors = [
    {
      target: {
        kind: "url",
        value: "/#/map",
      },
      node: "F-002",
      reason: "Presents the graph as a layered project map.",
    },
  ];

  assert.equal(resolveWhy(project, "/#/coverage"), null);
});

test("validates url anchors for route syntax without touching disk", async () => {
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
        kind: "url",
        value: "/#/map",
      },
      node: "F-001",
      reason: "Root-relative route.",
    },
    {
      target: {
        kind: "url",
        value: "https://ydk.example/docs",
      },
      node: "F-001",
      reason: "Externally hosted surface.",
    },
    {
      target: {
        kind: "url",
        value: "foo",
      },
      node: "F-001",
      reason: "Neither a route nor a URL.",
    },
    {
      target: {
        kind: "url",
        value: "",
      },
      node: "F-001",
      reason: "Empty route.",
    },
    {
      target: {
        kind: "url",
        value: "http://",
      },
      node: "F-001",
      reason: "Malformed absolute URL.",
    },
    {
      target: {
        kind: "url",
        value: "//ydk.example/docs",
      },
      node: "F-001",
      reason: "Protocol-relative URL rather than a root-relative route.",
    },
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((error) => error.includes("url target value")),
    [
      'Anchor foo has invalid url target value: "foo"',
      'Anchor  has invalid url target value: ""',
      'Anchor http:// has invalid url target value: "http://"',
      'Anchor //ydk.example/docs has invalid url target value: "//ydk.example/docs"',
    ],
  );
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
  assert.equal(trace.at(0)?.node.id, "F-002");
  assert.equal(trace.at(-1)?.node.id, "M-001");

  // Asserted structurally so re-parenting a node in .ydk/graph.yaml is not a test failure.
  for (const [index, step] of trace.entries()) {
    if (index === 0) {
      assert.equal(step.via, undefined);
      continue;
    }

    assert.deepEqual(step.via, {
      from: trace[index - 1]?.node.id,
      to: step.node.id,
      type: "supports",
    });
  }
});
