import assert from "node:assert/strict";
import test from "node:test";
import { allTracesToRoot } from "../src/graph/trace.ts";
import {
  coveragePercent,
  renderCoverage,
  renderDirectoryCoverage,
  renderGraphEdges,
  renderGraphJson,
  renderGraphTree,
  renderMeter,
  renderStaleAnchors,
  renderTraceSection,
  renderUnanchoredNodes,
} from "../src/render.ts";
import type { CoverageReport } from "../src/graph/coverage.ts";
import type { Anchor, GraphConfig } from "../src/graph/types.ts";

const multiParentGraph: GraphConfig = {
  version: 1,
  nodes: [
    { id: "M-001", type: "mission", title: "Mission" },
    { id: "O-001", type: "outcome", title: "First outcome" },
    { id: "O-002", type: "outcome", title: "Second outcome" },
    { id: "C-001", type: "capability", title: "Capability" },
    { id: "F-001", type: "feature", title: "Feature" },
  ],
  edges: [
    { from: "O-001", to: "M-001", type: "supports" },
    { from: "O-002", to: "M-001", type: "supports" },
    { from: "C-001", to: "O-001", type: "supports" },
    { from: "C-001", to: "O-002", type: "supports" },
    { from: "F-001", to: "C-001", type: "supports" },
  ],
};

const anchors: Anchor[] = [
  { target: { kind: "file", value: "src/app.ts" }, node: "F-001", reason: "Runs the app." },
  { target: { kind: "file", value: "src/lib.ts" }, node: "F-001", reason: "Holds the library." },
  { target: { kind: "directory", value: "src" }, node: "C-001", reason: "Implements the capability." },
];

const coverageReport: CoverageReport = {
  anchorableNodeCount: 37,
  anchoredNodeCount: 32,
  unanchoredNodes: [
    { id: "F-010", type: "feature", title: "Preview downstream service effects" },
    { id: "F-016", type: "feature", title: "Diff signed manifests offline" },
    { id: "F-022", type: "feature", title: "Replay drift alerts against change intent" },
    { id: "F-031", type: "feature", title: "Export an audit bundle" },
    { id: "C-009", type: "capability", title: "Verify deployment provenance" },
  ],
  totalFiles: 256,
  anchoredFiles: 167,
  directories: [
    { path: ".", totalFiles: 2, anchoredFiles: 1, children: [] },
    {
      path: "src/",
      totalFiles: 10,
      anchoredFiles: 8,
      children: [{ path: "src/graph/", totalFiles: 4, anchoredFiles: 4, children: [] }],
    },
  ],
  staleAnchors: [
    { display: "src/legacy.ts", node: "F-002", reason: "file not found" },
    { display: "docs/*.mdx", node: "C-001", reason: "pattern matches no files" },
  ],
  assessedNodes: [],
  averageScore: null,
};

const assessedReport: CoverageReport = {
  ...coverageReport,
  assessedNodes: [
    { id: "C-001", type: "capability", title: "Verify deployment provenance", score: 3, assessed: "2026-08-23" },
    { id: "F-001", type: "feature", title: "Export an audit bundle", score: 2, assessed: "2026-08-20" },
  ],
  averageScore: 2.5,
};

const plain = { color: false, width: 60 };

function tracesFor(startId: string) {
  const traces = allTracesToRoot(multiParentGraph, startId);
  assert.ok(traces);
  return traces;
}

test("renders the graph as a tree with a right-aligned metadata column", () => {
  assert.equal(
    renderGraphTree(multiParentGraph, anchors, plain),
    [
      "M-001  Mission                                       mission",
      "├── O-001  First outcome       1 cap · 1 feature · 3 anchors",
      "│   └── C-001  Capability              1 feature · 3 anchors",
      "│       └── F-001  Feature                         2 anchors",
      "└── O-002  Second outcome      1 cap · 1 feature · 3 anchors",
      "    └── C-001  Capability              1 feature · 3 anchors",
      "        └── F-001  Feature                         2 anchors",
    ].join("\n"),
  );
});

test("ends every tree row at the same column", () => {
  const lengths = new Set(
    renderGraphTree(multiParentGraph, anchors, plain)
      .split("\n")
      .map((line) => line.length),
  );

  assert.deepEqual([...lengths], [60]);
});

test("truncates the tree at the requested depth and counts hidden nodes once", () => {
  assert.equal(
    renderGraphTree(multiParentGraph, anchors, { ...plain, depth: 1 }),
    [
      "M-001  Mission                                       mission",
      "├── O-001  First outcome       1 cap · 1 feature · 3 anchors",
      "└── O-002  Second outcome      1 cap · 1 feature · 3 anchors",
      "    2 nodes hidden — ydk graph --depth 2 to expand, --json for machine output",
    ].join("\n"),
  );
});

test("names the hidden node type when the hidden nodes share one", () => {
  const tree = renderGraphTree(multiParentGraph, anchors, { ...plain, depth: 2 });

  assert.ok(tree.endsWith("1 feature hidden — ydk graph --depth 3 to expand, --json for machine output"));
});

test("prints the legacy edge list for --flat", () => {
  assert.equal(
    renderGraphEdges(multiParentGraph),
    [
      "O-001 -[supports]-> M-001",
      "O-002 -[supports]-> M-001",
      "C-001 -[supports]-> O-001",
      "C-001 -[supports]-> O-002",
      "F-001 -[supports]-> C-001",
    ].join("\n"),
  );
});

test("prints the loaded nodes and edges for --json", () => {
  assert.deepEqual(JSON.parse(renderGraphJson(multiParentGraph)), {
    nodes: multiParentGraph.nodes,
    edges: multiParentGraph.edges,
  });
});

test("renders a trace as an indented tree and hints at alternate paths", () => {
  assert.equal(
    renderTraceSection(tracesFor("F-001"), { ...plain, hintCommand: "ydk why src/app.ts" }),
    [
      "F-001  Feature                                       feature",
      "  └─ C-001  Capability                            capability",
      "      └─ O-001  First outcome                        outcome",
      "          └─ M-001  Mission                          mission",
      "",
      "  1 alternate path via O-002 · ydk why src/app.ts --all-paths",
    ].join("\n"),
  );
});

test("omits the hint when only one path reaches the mission", () => {
  const section = renderTraceSection(tracesFor("O-001"), { ...plain, hintCommand: "ydk trace O-001" });

  assert.equal(
    section,
    [
      "O-001  First outcome                                 outcome",
      "  └─ M-001  Mission                                  mission",
    ].join("\n"),
  );
});

test("labels each path for --all-paths", () => {
  assert.equal(
    renderTraceSection(tracesFor("F-001"), { ...plain, allPaths: true }),
    [
      "path 1 (shortest)",
      "F-001  Feature                                       feature",
      "  └─ C-001  Capability                            capability",
      "      └─ O-001  First outcome                        outcome",
      "          └─ M-001  Mission                          mission",
      "",
      "path 2",
      "F-001  Feature                                       feature",
      "  └─ C-001  Capability                            capability",
      "      └─ O-002  Second outcome                       outcome",
      "          └─ M-001  Mission                          mission",
    ].join("\n"),
  );
});

test("renders the coverage summary and a truncated unanchored list", () => {
  assert.equal(
    renderCoverage(coverageReport, plain),
    [
      "  nodes anchored   32 / 37   █████████░   86%",
      "  files anchored  167 / 256  ███████░░░   65%",
      "  stale anchors     2        ydk coverage --stale to list",
      "",
      "  unanchored nodes",
      "    F-010  Preview downstream service effects",
      "    F-016  Diff signed manifests offline",
      "    F-022  Replay drift alerts against change intent",
      "    +2 more · ydk coverage --unanchored",
    ].join("\n"),
  );
});

test("drops the unanchored section and the stale pointer when there is nothing to report", () => {
  const clean: CoverageReport = {
    ...coverageReport,
    anchoredNodeCount: 37,
    unanchoredNodes: [],
    staleAnchors: [],
  };

  assert.equal(
    renderCoverage(clean, plain),
    [
      "  nodes anchored   37 / 37   ██████████  100%",
      "  files anchored  167 / 256  ███████░░░   65%",
      "  stale anchors     0",
    ].join("\n"),
  );
});

test("adds the assessed summary row and node scores when the project has assessments", () => {
  assert.equal(
    renderCoverage(assessedReport, plain),
    [
      "  nodes anchored   32 / 37   █████████░   86%",
      "  files anchored  167 / 256  ███████░░░   65%",
      "  stale anchors     2        ydk coverage --stale to list",
      "  nodes assessed    2 / 37   █░░░░░░░░░    5%  avg score 2.5",
      "",
      "  unanchored nodes",
      "    F-010  Preview downstream service effects",
      "    F-016  Diff signed manifests offline",
      "    F-022  Replay drift alerts against change intent",
      "    +2 more · ydk coverage --unanchored",
      "",
      "  assessed nodes",
      "    C-001  Verify deployment provenance  score 3/4",
      "    F-001  Export an audit bundle        score 2/4",
    ].join("\n"),
  );
});

test("leaves the coverage report unchanged when nothing has been assessed", () => {
  assert.ok(!renderCoverage(coverageReport, plain).includes("assessed"));
});

test("rounds the meter to the nearest of ten cells", () => {
  assert.equal(renderMeter(100, plain), "██████████");
  assert.equal(renderMeter(86, plain), "█████████░");
  assert.equal(renderMeter(65, plain), "███████░░░");
  assert.equal(renderMeter(5, plain), "█░░░░░░░░░");
  assert.equal(renderMeter(4, plain), "░░░░░░░░░░");
  assert.equal(renderMeter(0, plain), "░░░░░░░░░░");
});

test("treats an empty total as fully covered", () => {
  assert.equal(coveragePercent(0, 0), 100);
  assert.equal(coveragePercent(1, 3), 33);
});

test("lists every unanchored node and stale anchor for their flags", () => {
  assert.equal(
    renderUnanchoredNodes(coverageReport, plain).split("\n").length,
    coverageReport.unanchoredNodes.length + 1,
  );
  assert.equal(
    renderStaleAnchors(coverageReport, plain),
    [
      "  stale anchors",
      "    src/legacy.ts  F-002  file not found",
      "    docs/*.mdx     C-001  pattern matches no files",
    ].join("\n"),
  );
});

test("indents child directories under their parent for --dirs", () => {
  assert.equal(
    renderDirectoryCoverage(coverageReport, plain),
    [
      "  directory coverage",
      "  .             1 / 2   █████░░░░░   50%",
      "  src/          8 / 10  ████████░░   80%",
      "    src/graph/  4 / 4   ██████████  100%",
    ].join("\n"),
  );
});

test("emits ANSI escapes only when color is enabled", () => {
  const colored = { color: true, width: 60 };

  assert.match(renderGraphTree(multiParentGraph, anchors, colored), /\u001B\[/u);
  assert.match(renderCoverage(coverageReport, colored), /\u001B\[/u);
  assert.match(
    renderTraceSection(tracesFor("F-001"), { ...colored, hintCommand: "ydk trace F-001" }),
    /\u001B\[/u,
  );

  assert.match(renderCoverage(assessedReport, colored), /\u001B\[/u);

  assert.doesNotMatch(renderGraphTree(multiParentGraph, anchors, plain), /\u001B\[/u);
  assert.doesNotMatch(renderCoverage(coverageReport, plain), /\u001B\[/u);
  assert.doesNotMatch(renderCoverage(assessedReport, plain), /\u001B\[/u);
  assert.doesNotMatch(
    renderTraceSection(tracesFor("F-001"), { ...plain, hintCommand: "ydk trace F-001" }),
    /\u001B\[/u,
  );
});
