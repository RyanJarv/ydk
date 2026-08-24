import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProject } from "../src/graph/loadProject.ts";
import { resolveWhy } from "../src/graph/resolveWhy.ts";
import { traceToRoot } from "../src/graph/trace.ts";
import { validateProject } from "../src/graph/validateProject.ts";

const GRAPH_YAML = [
  "version: 1",
  "nodes:",
  "  - id: M-001",
  "    type: mission",
  "    title: Mission",
  "  - id: C-001",
  "    type: capability",
  "    title: Capability",
  "edges:",
  "  - from: C-001",
  "    to: M-001",
  "    type: supports",
  "",
].join("\n");

const ANCHORS_YAML = ["version: 1", "anchors: []", ""].join("\n");

/** Writes a throwaway .ydk directory so loading can be exercised without the repo's own files. */
async function createConfiguredProject(assessmentsYaml?: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-assessments-"));
  await mkdir(path.join(root, ".ydk"), { recursive: true });
  await writeFile(path.join(root, ".ydk", "graph.yaml"), GRAPH_YAML, "utf8");
  await writeFile(path.join(root, ".ydk", "anchors.yaml"), ANCHORS_YAML, "utf8");

  if (assessmentsYaml !== undefined) {
    await writeFile(path.join(root, ".ydk", "assessments.yaml"), assessmentsYaml, "utf8");
  }

  return root;
}

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

test("validates that an anchor names a target kind some resolver implements", async () => {
  const project = await loadProject(await createConfiguredProject());
  project.anchors.anchors = [
    {
      target: {
        kind: "fille",
        value: "src/cli.ts",
      },
      node: "C-001",
      reason: "Misspelled file kind.",
    },
    {
      target: {
        kind: "symbol",
        value: {
          path: "src/cli.ts",
          symbol: "main",
        },
      },
      node: "C-001",
      reason: "Kind the model never implemented.",
    },
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'Anchor fille:"src/cli.ts" uses unknown target kind: fille (supported kinds: directory, file, filePattern, packageScript, url)',
    'Anchor symbol:{"path":"src/cli.ts","symbol":"main"} uses unknown target kind: symbol (supported kinds: directory, file, filePattern, packageScript, url)',
  ]);
});

test("loads assessments from .ydk/assessments.yaml", async () => {
  const root = await createConfiguredProject(
    [
      "version: 1",
      "",
      "assessments:",
      "  - node: C-001",
      "    score: 3",
      "    assessed: 2026-08-23",
      "    unfulfilled:",
      "      - Trace only returns the first path.",
      "    undeclared:",
      "      - targetResolver also formats display strings.",
      "  - node: F-001",
      "    score: 4",
      "    assessed: 2026-08-20",
      "",
    ].join("\n"),
  );

  const project = await loadProject(root);

  assert.deepEqual(project.assessments, {
    version: 1,
    assessments: [
      {
        node: "C-001",
        score: 3,
        assessed: "2026-08-23",
        unfulfilled: ["Trace only returns the first path."],
        undeclared: ["targetResolver also formats display strings."],
      },
      {
        node: "F-001",
        score: 4,
        assessed: "2026-08-20",
      },
    ],
  });
});

test("loads an empty assessment list when the file is absent", async () => {
  const project = await loadProject(await createConfiguredProject());

  assert.deepEqual(project.assessments, { version: 1, assessments: [] });
});

test("fails to load an assessments file that holds no assessment list", async () => {
  const root = await createConfiguredProject("version: 1\nassessment: C-001\n");

  await assert.rejects(loadProject(root), /must contain an assessments list/u);
});

test("validates that an assessment names an anchorable node", async () => {
  const project = await loadProject(await createConfiguredProject());
  project.assessments.assessments = [
    { node: "C-404", score: 3, assessed: "2026-08-23" },
    { node: "M-001", score: 3, assessed: "2026-08-23" },
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((error) => error.startsWith("Assessment")),
    [
      "Assessment references unknown node: C-404",
      "Assessment M-001 uses non-anchorable node type: mission",
    ],
  );
});

test("validates that a score is an integer within the rubric", async () => {
  const project = await loadProject(await createConfiguredProject());
  project.assessments.assessments = [
    { node: "C-001", score: 5, assessed: "2026-08-23" },
    { node: "C-001", score: -1, assessed: "2026-08-23" },
    { node: "C-001", score: 2.5, assessed: "2026-08-23" },
    { node: "C-001", assessed: "2026-08-23" } as never,
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((error) => error.includes("invalid score")),
    [
      "Assessment C-001 has invalid score: 5",
      "Assessment C-001 has invalid score: -1",
      "Assessment C-001 has invalid score: 2.5",
      "Assessment C-001 has invalid score: undefined",
    ],
  );
});

test("validates that assessed names a real day in ISO order", async () => {
  const project = await loadProject(await createConfiguredProject());
  project.assessments.assessments = [
    { node: "C-001", score: 3, assessed: "23 August 2026" },
    { node: "C-001", score: 3, assessed: "2026-02-30" },
    { node: "C-001", score: 3 } as never,
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((error) => error.includes("invalid assessed date")),
    [
      'Assessment C-001 has invalid assessed date: "23 August 2026"',
      'Assessment C-001 has invalid assessed date: "2026-02-30"',
      "Assessment C-001 has invalid assessed date: undefined",
    ],
  );
});

test("rejects a second assessment of the same node", async () => {
  const project = await loadProject(await createConfiguredProject());
  project.assessments.assessments = [
    { node: "C-001", score: 3, assessed: "2026-08-23" },
    { node: "C-001", score: 1, assessed: "2026-08-24" },
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["Duplicate assessment for node: C-001"]);
});

test("validates that every finding is a string", async () => {
  const project = await loadProject(await createConfiguredProject());
  project.assessments.assessments = [
    {
      node: "C-001",
      score: 2,
      assessed: "2026-08-23",
      // What YAML makes of a finding whose sentence carries an unquoted `: `.
      unfulfilled: [{ "The explorer has no path query": "its search matches display text." }],
      undeclared: "targetResolver also formats display strings.",
    } as never,
  ];

  const result = validateProject(project);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'Assessment C-001 has a non-string unfulfilled entry at index 0: {"The explorer has no path query":"its search matches display text."}',
    'Assessment C-001 has a non-list undeclared value: "targetResolver also formats display strings."',
  ]);
});

test("accepts a well-formed assessment of an anchorable node", async () => {
  const project = await loadProject(await createConfiguredProject());
  project.assessments.assessments = [{ node: "C-001", score: 0, assessed: "2026-08-23" }];

  assert.deepEqual(validateProject(project), { ok: true, errors: [] });
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
