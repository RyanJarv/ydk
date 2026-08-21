#!/usr/bin/env node
import { computeCoverage } from "./graph/coverage.ts";
import { loadProject } from "./graph/loadProject.ts";
import { resolveWhy } from "./graph/resolveWhy.ts";
import {
  DEFAULT_SERVE_HOST,
  DEFAULT_SERVE_PORT,
  serveProject,
} from "./serve/server.ts";
import { allTracesToRoot } from "./graph/trace.ts";
import { validateProject } from "./graph/validateProject.ts";
import {
  renderCoverage,
  renderDirectoryCoverage,
  renderGraphEdges,
  renderGraphJson,
  renderGraphTree,
  renderStaleAnchors,
  renderTraceSection,
  renderUnanchoredNodes,
  renderWhyHeader,
  type RenderOptions,
} from "./render.ts";

const HELP_ARGUMENTS = new Set(["--help", "-h", "help"]);
const MAX_TRACES = 50;

function usage(): string {
  return [
    "Usage:",
    "  ydk why <artifact-path> [--all-paths] [--json]",
    "  ydk trace <node-id> [--all-paths] [--json]",
    "  ydk validate",
    "  ydk graph [--depth <n>] [--flat] [--json]",
    "  ydk coverage [--unanchored] [--stale] [--dirs] [--json]",
    "  ydk serve [--host <host>] [--port <port>]",
    "",
    "Run `ydk <command> help` for command-specific help.",
    "(`-h` and `--help` also work when preserved by the caller.)",
  ].join("\n");
}

function commandUsage(command: string): string | null {
  const helpOption = "  -h, --help, help  Show command help";
  const jsonOption = "  --json            Print machine-readable JSON";
  const allPathsOption = "  --all-paths       Print every path to the mission";

  switch (command) {
    case "why":
      return [
        "Usage:",
        "  ydk why <artifact-path> [options]",
        "",
        "Explain why an artifact exists.",
        "",
        "Options:",
        allPathsOption,
        jsonOption,
        helpOption,
      ].join("\n");
    case "trace":
      return [
        "Usage:",
        "  ydk trace <node-id> [options]",
        "",
        "Trace a graph node to the project mission.",
        "",
        "Options:",
        allPathsOption,
        jsonOption,
        helpOption,
      ].join("\n");
    case "validate":
      return [
        "Usage:",
        "  ydk validate",
        "",
        "Validate the project's YDK configuration.",
        "",
        "Options:",
        helpOption,
      ].join("\n");
    case "graph":
      return [
        "Usage:",
        "  ydk graph [options]",
        "",
        "Print the project's purpose graph as a tree rooted at the mission.",
        "",
        "Options:",
        "  --depth <n>       Limit the levels shown below the mission",
        "  --flat            Print the purpose graph edges one per line",
        jsonOption,
        helpOption,
      ].join("\n");
    case "coverage":
      return [
        "Usage:",
        "  ydk coverage [options]",
        "",
        "Report how much of the project is anchored to the purpose graph.",
        "",
        "Options:",
        "  --unanchored      List every anchorable node without an anchor",
        "  --stale           List every anchor whose target is missing",
        "  --dirs            Break file coverage down by directory",
        jsonOption,
        helpOption,
      ].join("\n");
    case "serve":
      return [
        "Usage:",
        "  ydk serve [options]",
        "",
        "Start the local project explorer.",
        "",
        "Options:",
        `  --host <host>     Host to bind (default: ${DEFAULT_SERVE_HOST})`,
        `  --port <port>     Non-privileged port to bind (default: ${DEFAULT_SERVE_PORT})`,
        helpOption,
      ].join("\n");
    default:
      return null;
  }
}

function renderOptions(): RenderOptions {
  return {
    color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    width: process.stdout.columns,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command] = args;
  const commandArgs = args.slice(1);
  const value = firstPositional(commandArgs);

  if (command && HELP_ARGUMENTS.has(command)) {
    console.log(usage());
    return;
  }

  if (command && commandArgs.some((arg) => HELP_ARGUMENTS.has(arg))) {
    const help = commandUsage(command);
    if (help) {
      console.log(help);
      return;
    }
  }

  if (command === "serve") {
    await serveProject(parseServeOptions(commandArgs));
    return;
  }

  const project = await loadProject();
  const output = renderOptions();

  if (command === "why" && value) {
    const options = parseTraceOptions(command, commandArgs);
    const result = resolveWhy(project, value);
    if (!result) {
      console.error(`No explanation found for ${value}`);
      process.exitCode = 1;
      return;
    }

    const traces = allTracesToRoot(project.graph, result.anchor.node, MAX_TRACES) ?? [result.trace];

    if (options.json) {
      console.log(
        JSON.stringify({ target: result.displayTarget, anchor: result.anchor, traces }, null, 2),
      );
      return;
    }

    console.log(renderWhyHeader(result, value, output));
    console.log("");
    console.log(
      renderTraceSection(traces, {
        ...output,
        allPaths: options.allPaths,
        hintCommand: `ydk why ${value}`,
      }),
    );
    return;
  }

  if (command === "trace" && value) {
    const options = parseTraceOptions(command, commandArgs);
    const traces = allTracesToRoot(project.graph, value, MAX_TRACES);
    if (!traces) {
      console.error(`No trace found for ${value}`);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({ traces }, null, 2));
      return;
    }

    console.log(
      renderTraceSection(traces, {
        ...output,
        allPaths: options.allPaths,
        hintCommand: `ydk trace ${value}`,
      }),
    );
    return;
  }

  if (command === "validate") {
    const result = validateProject(project);
    if (result.ok) {
      console.log("ydk configuration is valid");
      return;
    }

    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  if (command === "graph") {
    const options = parseGraphOptions(commandArgs);

    if (options.json) {
      console.log(renderGraphJson(project.graph));
      return;
    }

    if (options.flat) {
      const edges = renderGraphEdges(project.graph);
      if (edges) {
        console.log(edges);
      }
      return;
    }

    if (!project.graph.nodes.some((node) => node.type === "mission")) {
      console.error("No mission node found; run `ydk graph --flat` to list the graph edges");
      process.exitCode = 1;
      return;
    }

    console.log(
      renderGraphTree(project.graph, project.anchors.anchors, { ...output, depth: options.depth }),
    );
    return;
  }

  if (command === "coverage") {
    const options = parseCoverageOptions(commandArgs);
    const report = computeCoverage(project);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (options.unanchored) {
      console.log(renderUnanchoredNodes(report, output));
      return;
    }

    if (options.stale) {
      console.log(renderStaleAnchors(report, output));
      return;
    }

    if (options.dirs) {
      console.log(renderDirectoryCoverage(report, output));
      return;
    }

    console.log(renderCoverage(report, output));
    return;
  }

  console.log(usage());
  process.exitCode = 1;
}

function firstPositional(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("-"));
}

function unknownOption(command: string, option: string): Error {
  return new Error(`Unknown option for ydk ${command}: ${option}\n\n${commandUsage(command) ?? usage()}`);
}

function parseTraceOptions(command: string, args: string[]): { allPaths: boolean; json: boolean } {
  const options = { allPaths: false, json: false };

  for (const arg of args) {
    if (!arg.startsWith("-")) {
      continue;
    }

    if (arg === "--all-paths") {
      options.allPaths = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    throw unknownOption(command, arg);
  }

  return options;
}

function parseGraphOptions(args: string[]): { depth?: number; flat: boolean; json: boolean } {
  const options: { depth?: number; flat: boolean; json: boolean } = { flat: false, json: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--depth") {
      const depth = Number(next);
      if (next === undefined || !Number.isInteger(depth) || depth < 0) {
        throw new Error(`ydk graph --depth expects a non-negative integer, received: ${next ?? ""}`);
      }
      options.depth = depth;
      index += 1;
      continue;
    }

    if (arg === "--flat") {
      options.flat = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg) {
      throw unknownOption("graph", arg);
    }
  }

  return options;
}

function parseCoverageOptions(args: string[]): {
  dirs: boolean;
  json: boolean;
  stale: boolean;
  unanchored: boolean;
} {
  const options = { dirs: false, json: false, stale: false, unanchored: false };

  for (const arg of args) {
    if (arg === "--dirs") {
      options.dirs = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--stale") {
      options.stale = true;
      continue;
    }

    if (arg === "--unanchored") {
      options.unanchored = true;
      continue;
    }

    throw unknownOption("coverage", arg);
  }

  return options;
}

function parseServeOptions(args: string[]): { host?: string; port?: number } {
  const options: { host?: string; port?: number } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--host" && next) {
      options.host = next;
      index += 1;
      continue;
    }

    if (arg === "--port" && next) {
      const port = Number(next);
      if (Number.isInteger(port) && port > 0) {
        options.port = port;
      }
      index += 1;
    }
  }

  return options;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
