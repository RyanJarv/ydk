import type { CoverageReport, DirectoryCoverage } from "./graph/coverage.ts";
import type { WhyResult } from "./graph/resolveWhy.ts";
import type { Anchor, GraphConfig, GraphNode, NodeId, TraceStep } from "./graph/types.ts";

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
};

const DEFAULT_WIDTH = 100;
const MIN_WIDTH = 40;
const MAX_WIDTH = 120;
const MIN_METADATA_GAP = 2;
const METER_CELLS = 10;
const METER_FILL_CELL = "█";
const METER_TRACK_CELL = "░";
const METER_WARNING_PERCENT = 70;
const UNANCHORED_PREVIEW_LIMIT = 3;
const ROOT_DIRECTORY_LABEL = ".";
const COVERAGE_LABELS = ["nodes anchored", "files anchored", "stale anchors", "nodes assessed"];
const MAX_SCORE = 4;
/** Below this a node's anchored artifacts do not yet fulfill what it claims. */
const SCORE_WARNING_LEVEL = 3;

export type RenderOptions = {
  color: boolean;
  width?: number;
};

export type GraphTreeOptions = RenderOptions & {
  depth?: number;
};

export type TraceSectionOptions = RenderOptions & {
  allPaths?: boolean;
  hintCommand?: string;
};

type Style = (text: string) => string;

type Palette = {
  id: Style;
  meta: Style;
  tree: Style;
  warn: Style;
  stale: Style;
  target: Style;
  fill: Style;
  track: Style;
};

function styler(color: boolean, code: string): Style {
  if (!color) {
    return (text) => text;
  }

  return (text) => (text.length === 0 ? "" : `${code}${text}${ANSI.reset}`);
}

export function createPalette(color: boolean): Palette {
  return {
    id: styler(color, ANSI.green),
    meta: styler(color, ANSI.dim),
    tree: styler(color, ANSI.dim),
    warn: styler(color, ANSI.yellow),
    stale: styler(color, ANSI.red),
    target: styler(color, ANSI.bold),
    fill: styler(color, ANSI.green),
    track: styler(color, ANSI.dim),
  };
}

function resolveWidth(width?: number): number {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return DEFAULT_WIDTH;
  }

  return Math.min(Math.max(Math.trunc(width), MIN_WIDTH), MAX_WIDTH);
}

type MetadataRow = {
  plain: string;
  styled: string;
  metadata: string;
};

/**
 * Right-aligns every metadata cell against one shared edge so the column stays
 * straight even when a long title pushes its row past the terminal width.
 */
function alignMetadata(rows: MetadataRow[], palette: Palette, width: number): string[] {
  const longestRow = Math.max(0, ...rows.map((row) => row.plain.length));
  const longestMetadata = Math.max(0, ...rows.map((row) => row.metadata.length));
  const edge = Math.max(width, longestRow + MIN_METADATA_GAP + longestMetadata);

  return rows.map((row) => {
    if (row.metadata.length === 0) {
      return row.styled;
    }

    const gap = Math.max(MIN_METADATA_GAP, edge - row.plain.length - row.metadata.length);
    return `${row.styled}${" ".repeat(gap)}${palette.meta(row.metadata)}`;
  });
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function renderGraphEdges(graph: GraphConfig): string {
  return graph.edges.map((edge) => `${edge.from} -[${edge.type}]-> ${edge.to}`).join("\n");
}

export function renderGraphJson(graph: GraphConfig): string {
  return JSON.stringify({ nodes: graph.nodes, edges: graph.edges }, null, 2);
}

export function renderGraphTree(graph: GraphConfig, anchors: Anchor[], options: GraphTreeOptions): string {
  const palette = createPalette(options.color);
  const width = resolveWidth(options.width);
  const children = childIndex(graph);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const anchorCounts = countAnchors(anchors);
  const descendants = new Map<NodeId, Set<NodeId>>();
  const depth = options.depth ?? Number.POSITIVE_INFINITY;
  const hidden = new Map<NodeId, GraphNode>();
  const rows: MetadataRow[] = [];

  const metadataFor = (node: GraphNode): string => {
    const subtree = descendantIds(node.id, children, descendants, new Set());
    if (subtree.size === 0) {
      return plural(anchorCounts.get(node.id) ?? 0, "anchor");
    }

    let capabilities = 0;
    let features = 0;
    let anchorTotal = anchorCounts.get(node.id) ?? 0;

    for (const id of subtree) {
      const descendant = nodesById.get(id);
      if (descendant?.type === "capability") {
        capabilities += 1;
      }
      if (descendant?.type === "feature") {
        features += 1;
      }
      anchorTotal += anchorCounts.get(id) ?? 0;
    }

    const parts: string[] = [];
    if (capabilities > 0) {
      parts.push(plural(capabilities, "cap"));
    }
    if (features > 0) {
      parts.push(plural(features, "feature"));
    }
    parts.push(plural(anchorTotal, "anchor"));

    return parts.join(" · ");
  };

  const pushNode = (prefix: string, node: GraphNode, metadata: string): void => {
    rows.push({
      plain: `${prefix}${node.id}  ${node.title}`,
      styled: `${palette.tree(prefix)}${palette.id(node.id)}  ${node.title}`,
      metadata,
    });
  };

  const walk = (node: GraphNode, prefix: string, level: number, path: Set<NodeId>): void => {
    const kids = (children.get(node.id) ?? []).filter((kid) => !path.has(kid.id));
    if (kids.length === 0) {
      return;
    }

    if (level >= depth) {
      for (const kid of kids) {
        hidden.set(kid.id, kid);
        for (const id of descendantIds(kid.id, children, descendants, new Set())) {
          const descendant = nodesById.get(id);
          if (descendant) {
            hidden.set(descendant.id, descendant);
          }
        }
      }
      return;
    }

    kids.forEach((kid, index) => {
      const last = index === kids.length - 1;
      pushNode(`${prefix}${last ? "└── " : "├── "}`, kid, metadataFor(kid));
      walk(kid, `${prefix}${last ? "    " : "│   "}`, level + 1, new Set(path).add(kid.id));
    });
  };

  for (const root of graph.nodes.filter((node) => node.type === "mission")) {
    pushNode("", root, root.type);
    walk(root, "", 0, new Set([root.id]));
  }

  const lines = alignMetadata(rows, palette, width);

  if (hidden.size > 0 && Number.isFinite(depth)) {
    lines.push(palette.meta(`    ${hiddenSummary([...hidden.values()], depth)}`));
  }

  return lines.join("\n");
}

function hiddenSummary(hidden: GraphNode[], depth: number): string {
  const types = new Set(hidden.map((node) => node.type));
  const label = types.size === 1 ? [...types][0] ?? "node" : "node";

  return [
    `${plural(hidden.length, label)} hidden`,
    `— ydk graph --depth ${depth + 1} to expand, --json for machine output`,
  ].join(" ");
}

function childIndex(graph: GraphConfig): Map<NodeId, GraphNode[]> {
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = new Map<NodeId, GraphNode[]>();

  for (const edge of graph.edges) {
    const child = nodesById.get(edge.from);
    if (!child || !nodesById.has(edge.to)) {
      continue;
    }

    const siblings = children.get(edge.to) ?? [];
    if (!siblings.some((sibling) => sibling.id === child.id)) {
      siblings.push(child);
    }
    children.set(edge.to, siblings);
  }

  for (const siblings of children.values()) {
    siblings.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  }

  return children;
}

function descendantIds(
  id: NodeId,
  children: Map<NodeId, GraphNode[]>,
  memo: Map<NodeId, Set<NodeId>>,
  stack: Set<NodeId>,
): Set<NodeId> {
  const cached = memo.get(id);
  if (cached) {
    return cached;
  }

  if (stack.has(id)) {
    return new Set();
  }

  stack.add(id);
  const collected = new Set<NodeId>();

  for (const child of children.get(id) ?? []) {
    collected.add(child.id);
    for (const nested of descendantIds(child.id, children, memo, stack)) {
      collected.add(nested);
    }
  }

  stack.delete(id);
  memo.set(id, collected);

  return collected;
}

function countAnchors(anchors: Anchor[]): Map<NodeId, number> {
  const counts = new Map<NodeId, number>();

  for (const anchor of anchors) {
    counts.set(anchor.node, (counts.get(anchor.node) ?? 0) + 1);
  }

  return counts;
}

export function renderWhyHeader(result: WhyResult, target: string, options: RenderOptions): string {
  const palette = createPalette(options.color);
  const lines = [palette.target(target)];

  // A directory, pattern, or route anchor covers more than the queried artifact,
  // so the header has to name the anchor that actually matched.
  if (result.displayTarget !== target) {
    lines.push(palette.meta(`  matched via ${result.anchor.target.kind} ${result.displayTarget}`));
  }

  lines.push(`${palette.meta("  anchored to ")}${palette.id(result.anchor.node)}`);
  lines.push(palette.meta(`  ${result.anchor.reason}`));

  return lines.join("\n");
}

export function renderTraceTree(trace: TraceStep[], options: RenderOptions): string {
  const palette = createPalette(options.color);
  const rows = trace.map((step, index) => {
    const prefix = index === 0 ? "" : `${" ".repeat(2 + 4 * (index - 1))}└─ `;

    return {
      plain: `${prefix}${step.node.id}  ${step.node.title}`,
      styled: `${palette.tree(prefix)}${palette.id(step.node.id)}  ${step.node.title}`,
      metadata: step.node.type,
    };
  });

  return alignMetadata(rows, palette, resolveWidth(options.width)).join("\n");
}

export function renderTraceSection(traces: TraceStep[][], options: TraceSectionOptions): string {
  const palette = createPalette(options.color);

  if (traces.length === 0) {
    return "";
  }

  if (options.allPaths) {
    return traces
      .map((trace, index) => {
        const label = index === 0 ? "path 1 (shortest)" : `path ${index + 1}`;
        return `${palette.meta(label)}\n${renderTraceTree(trace, options)}`;
      })
      .join("\n\n");
  }

  const [shortest] = traces;
  const lines = [renderTraceTree(shortest ?? [], options)];
  const hint = alternatePathHint(traces, options.hintCommand, palette);
  if (hint) {
    lines.push("", hint);
  }

  return lines.join("\n");
}

function alternatePathHint(traces: TraceStep[][], hintCommand: string | undefined, palette: Palette): string | null {
  const [shortest, alternate] = traces;
  if (!shortest || !alternate || !hintCommand) {
    return null;
  }

  const via = firstDivergentNodeId(shortest, alternate);
  const paths = plural(traces.length - 1, "alternate path");

  return palette.warn(`  ${paths}${via ? ` via ${via}` : ""} · ${hintCommand} --all-paths`);
}

function firstDivergentNodeId(shortest: TraceStep[], alternate: TraceStep[]): NodeId | null {
  const shortestIds = new Set(shortest.map((step) => step.node.id));

  for (const step of alternate.slice(1)) {
    if (!shortestIds.has(step.node.id)) {
      return step.node.id;
    }
  }

  for (let index = 1; index < Math.min(shortest.length, alternate.length); index += 1) {
    const candidate = alternate[index];
    if (candidate && candidate.node.id !== shortest[index]?.node.id) {
      return candidate.node.id;
    }
  }

  return null;
}

export function coveragePercent(value: number, total: number): number {
  if (total <= 0) {
    return 100;
  }

  return Math.round((value / total) * 100);
}

export function renderMeter(percent: number, options: RenderOptions): string {
  const palette = createPalette(options.color);
  const filled = Math.min(METER_CELLS, Math.max(0, Math.round((percent / 100) * METER_CELLS)));
  const fill = percent < METER_WARNING_PERCENT ? palette.warn : palette.fill;
  // Color alone separates the track from the fill; plain output needs a lighter glyph.
  const track = options.color ? METER_FILL_CELL : METER_TRACK_CELL;

  return `${fill(METER_FILL_CELL.repeat(filled))}${palette.track(track.repeat(METER_CELLS - filled))}`;
}

type CoverageColumns = {
  labelWidth: number;
  valueWidth: number;
  totalWidth: number;
};

function coverageColumns(report: CoverageReport): CoverageColumns {
  const values = [
    report.anchoredNodeCount,
    report.anchoredFiles,
    report.staleAnchors.length,
    report.assessedNodes.length,
  ];
  const totals = [report.anchorableNodeCount, report.totalFiles];

  return {
    labelWidth: Math.max(...COVERAGE_LABELS.map((label) => label.length)),
    valueWidth: Math.max(...values.map((value) => String(value).length)),
    totalWidth: Math.max(...totals.map((total) => String(total).length)),
  };
}

function meterRow(
  label: string,
  value: number,
  total: number,
  columns: CoverageColumns,
  options: RenderOptions,
): string {
  const percent = coveragePercent(value, total);
  const counts = `${String(value).padStart(columns.valueWidth)} / ${String(total).padEnd(columns.totalWidth)}`;

  return `  ${label.padEnd(columns.labelWidth)}  ${counts}  ${renderMeter(percent, options)}  ${String(percent).padStart(3)}%`;
}

export function renderCoverageSummary(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);
  const columns = coverageColumns(report);
  const staleCount = report.staleAnchors.length;
  const staleValue = String(staleCount).padStart(columns.valueWidth);
  const stalePadding = " ".repeat(3 + columns.totalWidth);
  const stalePointer = staleCount > 0 ? `  ${palette.meta("ydk coverage --stale to list")}` : "";

  const lines = [
    meterRow("nodes anchored", report.anchoredNodeCount, report.anchorableNodeCount, columns, options),
    meterRow("files anchored", report.anchoredFiles, report.totalFiles, columns, options),
    `  ${"stale anchors".padEnd(columns.labelWidth)}  ${
      staleCount > 0 ? palette.stale(staleValue) : staleValue
    }${stalePadding}${stalePointer}`.trimEnd(),
  ];

  // A project with no assessments file keeps the report it had before assessments existed.
  if (report.assessedNodes.length > 0) {
    const row = meterRow(
      "nodes assessed",
      report.assessedNodes.length,
      report.anchorableNodeCount,
      columns,
      options,
    );
    const average =
      report.averageScore === null ? "" : `  ${palette.meta(`avg score ${report.averageScore.toFixed(1)}`)}`;

    lines.push(`${row}${average}`);
  }

  return lines.join("\n");
}

export function renderCoverage(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);
  const preview = renderUnanchoredPreview(report, options);
  const assessed = renderAssessedNodes(report, options);
  const lines = [renderCoverageSummary(report, options)];

  if (preview) {
    lines.push("", preview);
  }

  if (assessed) {
    lines.push("", assessed);
  }

  // The summary counts the unanchored files; only this pointer names them.
  if (report.unanchoredFiles.length > 0) {
    const count = plural(report.unanchoredFiles.length, "file");
    lines.push("", palette.meta(`  ${count} unanchored · ydk coverage --unanchored-files`));
  }

  return lines.join("\n");
}

function renderAssessedNodes(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);
  const nodes = report.assessedNodes;

  if (nodes.length === 0) {
    return "";
  }

  const idWidth = Math.max(...nodes.map((node) => node.id.length));
  const titleWidth = Math.max(...nodes.map((node) => node.title.length));

  return [
    palette.meta("  assessed nodes"),
    ...nodes.map((node) => {
      const score = `score ${node.score}/${MAX_SCORE}`;
      const style = node.score < SCORE_WARNING_LEVEL ? palette.warn : palette.meta;

      return `    ${palette.id(node.id.padEnd(idWidth))}  ${node.title.padEnd(titleWidth)}  ${style(score)}`;
    }),
  ].join("\n");
}

function unanchoredLines(
  nodes: CoverageReport["unanchoredNodes"],
  options: RenderOptions,
): string[] {
  const palette = createPalette(options.color);

  return nodes.map((node) => `    ${palette.id(node.id)}  ${node.title}`);
}

function renderUnanchoredPreview(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);
  const nodes = report.unanchoredNodes;

  if (nodes.length === 0) {
    return "";
  }

  const shown = nodes.slice(0, UNANCHORED_PREVIEW_LIMIT);
  const lines = [palette.meta("  unanchored nodes"), ...unanchoredLines(shown, options)];

  if (nodes.length > shown.length) {
    lines.push(palette.meta(`    +${nodes.length - shown.length} more · ydk coverage --unanchored`));
  }

  return lines.join("\n");
}

export function renderUnanchoredNodes(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);

  if (report.unanchoredNodes.length === 0) {
    return palette.meta("  no unanchored nodes");
  }

  return [palette.meta("  unanchored nodes"), ...unanchoredLines(report.unanchoredNodes, options)].join("\n");
}

export function renderUnanchoredFiles(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);

  if (report.unanchoredFiles.length === 0) {
    return palette.meta("  no unanchored files");
  }

  const groups = groupFilesByDirectory(report.unanchoredFiles);
  const pathWidth = Math.max(...groups.map((group) => group.directory.length));

  return [
    palette.meta("  unanchored files"),
    ...groups.flatMap((group) => [
      `    ${group.directory.padEnd(pathWidth)}  ${palette.meta(plural(group.files.length, "file"))}`,
      ...group.files.map((file) => `      ${file}`),
    ]),
  ].join("\n");
}

/** Keeps each directory heading once, with the file names it holds beneath it. */
function groupFilesByDirectory(files: string[]): Array<{ directory: string; files: string[] }> {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const separator = file.lastIndexOf("/");
    const directory = separator < 0 ? ROOT_DIRECTORY_LABEL : `${file.slice(0, separator)}/`;
    const names = groups.get(directory) ?? [];
    names.push(file.slice(separator + 1));
    groups.set(directory, names);
  }

  return [...groups.entries()]
    .map(([directory, names]) => ({ directory, files: names }))
    .sort((left, right) => (left.directory < right.directory ? -1 : 1));
}

export function renderStaleAnchors(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);

  if (report.staleAnchors.length === 0) {
    return palette.meta("  no stale anchors");
  }

  const displayWidth = Math.max(...report.staleAnchors.map((anchor) => anchor.display.length));
  const nodeWidth = Math.max(...report.staleAnchors.map((anchor) => anchor.node.length));

  return [
    palette.meta("  stale anchors"),
    ...report.staleAnchors.map((anchor) => {
      const display = anchor.display.padEnd(displayWidth);
      const node = anchor.node.padEnd(nodeWidth);
      return `    ${palette.stale(display)}  ${palette.id(node)}  ${palette.meta(anchor.reason)}`;
    }),
  ].join("\n");
}

export function renderDirectoryCoverage(report: CoverageReport, options: RenderOptions): string {
  const palette = createPalette(options.color);
  const rows = flattenDirectories(report.directories, 0);

  if (rows.length === 0) {
    return palette.meta("  no files found");
  }

  const pathWidth = Math.max(...rows.map((row) => row.indent + row.directory.path.length));
  const valueWidth = Math.max(...rows.map((row) => String(row.directory.anchoredFiles).length));
  const totalWidth = Math.max(...rows.map((row) => String(row.directory.totalFiles).length));

  return [
    palette.meta("  directory coverage"),
    ...rows.map((row) => {
      const percent = coveragePercent(row.directory.anchoredFiles, row.directory.totalFiles);
      const label = `${" ".repeat(row.indent)}${row.directory.path}`.padEnd(pathWidth);
      const counts = `${String(row.directory.anchoredFiles).padStart(valueWidth)} / ${String(
        row.directory.totalFiles,
      ).padEnd(totalWidth)}`;

      return `  ${label}  ${counts}  ${renderMeter(percent, options)}  ${String(percent).padStart(3)}%`;
    }),
  ].join("\n");
}

function flattenDirectories(
  directories: DirectoryCoverage[],
  indent: number,
): Array<{ directory: DirectoryCoverage; indent: number }> {
  return directories.flatMap((directory) => [
    { directory, indent },
    ...flattenDirectories(directory.children, indent + 2),
  ]);
}
