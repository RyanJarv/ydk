import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProjectServer } from "../src/serve/server.ts";
import { createProjectView } from "../src/serve/projectView.ts";
import type { YdkProject } from "../src/graph/types.ts";

test("serves the browser runtime when inspecting an external project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ydk-external-project-"));
  const server = createProjectServer({ root });
  const handler = server.listeners("request")[0] as (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>;
  let statusCode: number | undefined;
  let headers: Record<string, string> | undefined;
  let body: Buffer | undefined;
  const response = {
    writeHead(status: number, responseHeaders: Record<string, string>) {
      statusCode = status;
      headers = responseHeaders;
      return this;
    },
    end(content?: Buffer) {
      body = content;
      return this;
    },
  } as unknown as ServerResponse;

  await handler(
    { url: "/vendor/vue.esm-browser.prod.js" } as IncomingMessage,
    response,
  );

  assert.equal(statusCode, 200);
  assert.match(headers?.["content-type"] ?? "", /^text\/javascript/);
  assert.match(body?.toString("utf8") ?? "", /createApp/);
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
