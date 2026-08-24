import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProject } from "../src/graph/loadProject.ts";
import { createProjectServer } from "../src/serve/server.ts";
import { createProjectView } from "../src/serve/projectView.ts";
import type { YdkProject } from "../src/graph/types.ts";

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

const ANCHORS_YAML = [
  "version: 1",
  "anchors:",
  "  - target:",
  "      kind: directory",
  "      value: docs/examples",
  "    node: C-001",
  "    reason: Explores how the purpose graph could be used.",
  "",
].join("\n");

type CapturedResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/** Writes a throwaway project the server can load, holding one anchored and one unanchored file. */
async function createServedProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-serve-project-"));
  await mkdir(path.join(root, ".ydk"), { recursive: true });
  await mkdir(path.join(root, "docs", "examples"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, ".ydk", "graph.yaml"), GRAPH_YAML, "utf8");
  await writeFile(path.join(root, ".ydk", "anchors.yaml"), ANCHORS_YAML, "utf8");
  await writeFile(path.join(root, "docs", "examples", "direct-cli.md"), "# Direct CLI\n", "utf8");
  await writeFile(path.join(root, "src", "cli.ts"), "export {};\n", "utf8");

  return root;
}

async function request(root: string, url: string): Promise<CapturedResponse> {
  const server = createProjectServer({ root });
  const handler = server.listeners("request")[0] as (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>;
  const captured: CapturedResponse = { status: 0, headers: {}, body: "" };
  const response = {
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    end(content?: Buffer | string) {
      captured.body = content === undefined ? "" : content.toString();
      return this;
    },
  } as unknown as ServerResponse;

  await handler({ url } as IncomingMessage, response);

  return captured;
}

test("serves the browser runtime when inspecting an external project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-external-project-"));

  const response = await request(root, "/vendor/vue.esm-browser.prod.js");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"] ?? "", /^text\/javascript/);
  assert.match(response.body, /createApp/);
});

test("serves the whole project graph the browser draws", async () => {
  const root = await createServedProject();

  const response = await request(root, "/api/project");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"] ?? "", /^application\/json/);
  const payload = JSON.parse(response.body);
  assert.equal(payload.validation.ok, true);
  assert.deepEqual(
    payload.project.nodes.map((node: { id: string }) => node.id),
    ["M-001", "C-001"],
  );
});

// Asking why one artifact exists is the CLI's job now; the browser has no route for it.
test("no longer answers artifact why queries", async () => {
  const root = await createServedProject();

  const response = await request(root, "/api/why?path=docs/examples/direct-cli.md");

  assert.equal(response.status, 404);
  assert.equal(response.body, "Not found");
});

test("exposes the files no anchor covers to the browser", async () => {
  const view = createProjectView(await loadProject(await createServedProject()));

  assert.deepEqual(view.coverage.unanchoredFiles, ["src/cli.ts"]);
  assert.equal(view.coverage.anchoredFiles + view.coverage.unanchoredFiles.length, view.coverage.totalFiles);
});

test("presents a url anchor as a live product surface", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-url-anchor-"));
  const project: YdkProject = {
    root,
    graph: {
      version: 1,
      nodes: [
        { id: "M-001", type: "mission", title: "Mission" },
        { id: "F-001", type: "feature", title: "Feature" },
      ],
      edges: [{ from: "F-001", to: "M-001", type: "supports" }],
    },
    anchors: {
      version: 1,
      anchors: [
        {
          target: { kind: "url", value: "/#/map" },
          node: "F-001",
          reason: "Presents the project map.",
        },
      ],
    },
    assessments: { version: 1, assessments: [] },
  };

  const view = createProjectView(project);

  assert.deepEqual(view.nodes.find((node) => node.id === "F-001")?.anchors, [
    {
      display: "/#/map",
      kind: "url",
      reason: "Presents the project map.",
      stale: false,
    },
  ]);
  assert.equal(view.stats.anchoredNodeCount, 1);
  assert.deepEqual(view.coverage.staleAnchors, []);
});

test("exposes an assessment on the node it judges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-assessment-view-"));
  const project: YdkProject = {
    root,
    graph: {
      version: 1,
      nodes: [
        { id: "M-001", type: "mission", title: "Mission" },
        { id: "F-001", type: "feature", title: "Feature" },
        { id: "F-002", type: "feature", title: "Unassessed feature" },
      ],
      edges: [
        { from: "F-001", to: "M-001", type: "supports" },
        { from: "F-002", to: "M-001", type: "supports" },
      ],
    },
    anchors: {
      version: 1,
      anchors: [
        {
          target: { kind: "url", value: "/#/map" },
          node: "F-001",
          reason: "Presents the project map.",
        },
      ],
    },
    assessments: {
      version: 1,
      assessments: [
        {
          node: "F-001",
          score: 2,
          assessed: "2026-08-23",
          unfulfilled: ["The map cannot be filtered."],
        },
      ],
    },
  };

  const view = createProjectView(project);

  assert.deepEqual(view.nodes.find((node) => node.id === "F-001")?.assessment, {
    score: 2,
    assessed: "2026-08-23",
    unfulfilled: ["The map cannot be filtered."],
    undeclared: [],
  });
  assert.equal(view.nodes.find((node) => node.id === "F-002")?.assessment, undefined);
  assert.deepEqual(view.coverage.assessedNodes, [
    { id: "F-001", type: "feature", title: "Feature", score: 2, assessed: "2026-08-23" },
  ]);
  assert.equal(view.coverage.averageScore, 2);
});
