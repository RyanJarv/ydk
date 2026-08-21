#!/usr/bin/env node
import { loadProject } from "./graph/loadProject.ts";
import { resolveWhy } from "./graph/resolveWhy.ts";
import {
  DEFAULT_SERVE_HOST,
  DEFAULT_SERVE_PORT,
  serveProject,
} from "./serve/server.ts";
import { traceToRoot } from "./graph/trace.ts";
import { validateProject } from "./graph/validateProject.ts";

const HELP_ARGUMENTS = new Set(["--help", "-h", "help"]);

function usage(): string {
  return [
    "Usage:",
    "  ydk why <artifact-path>",
    "  ydk trace <node-id>",
    "  ydk validate",
    "  ydk graph",
    "  ydk serve [--host <host>] [--port <port>]",
    "",
    "Run `ydk <command> help` for command-specific help.",
    "(`-h` and `--help` also work when preserved by the caller.)",
  ].join("\n");
}

function commandUsage(command: string): string | null {
  const helpOption = "  -h, --help, help  Show command help";

  switch (command) {
    case "why":
      return [
        "Usage:",
        "  ydk why <artifact-path>",
        "",
        "Explain why an artifact exists.",
        "",
        "Options:",
        helpOption,
      ].join("\n");
    case "trace":
      return [
        "Usage:",
        "  ydk trace <node-id>",
        "",
        "Trace a graph node to the project mission.",
        "",
        "Options:",
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
        "  ydk graph",
        "",
        "Print the project's purpose graph edges.",
        "",
        "Options:",
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
        `  --host <host>  Host to bind (default: ${DEFAULT_SERVE_HOST})`,
        `  --port <port>  Non-privileged port to bind (default: ${DEFAULT_SERVE_PORT})`,
        helpOption,
      ].join("\n");
    default:
      return null;
  }
}

function formatTrace(trace: NonNullable<ReturnType<typeof traceToRoot>>): string {
  return trace
    .map((step, index) => {
      if (index === 0 || !step.via) {
        return `${step.node.id} (${step.node.type}): ${step.node.title}`;
      }

      return `${step.via.type} -> ${step.node.id} (${step.node.type}): ${step.node.title}`;
    })
    .join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, value] = args;

  if (command && HELP_ARGUMENTS.has(command)) {
    console.log(usage());
    return;
  }

  if (command && args.slice(1).some((arg) => HELP_ARGUMENTS.has(arg))) {
    const help = commandUsage(command);
    if (help) {
      console.log(help);
      return;
    }
  }

  if (command === "serve") {
    await serveProject(parseServeOptions(process.argv.slice(3)));
    return;
  }

  const project = await loadProject();

  if (command === "why" && value) {
    const result = resolveWhy(project, value);
    if (!result) {
      console.error(`No explanation found for ${value}`);
      process.exitCode = 1;
      return;
    }

    console.log(result.displayTarget);
    if (result.matchedPattern) {
      console.log(`  matched pattern for ${value}`);
    }
    console.log(`  anchored to ${result.anchor.node}`);
    console.log(`  ${result.anchor.reason}`);
    console.log("");
    console.log(formatTrace(result.trace));
    return;
  }

  if (command === "trace" && value) {
    const trace = traceToRoot(project.graph, value);
    if (!trace) {
      console.error(`No trace found for ${value}`);
      process.exitCode = 1;
      return;
    }

    console.log(formatTrace(trace));
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
    for (const edge of project.graph.edges) {
      console.log(`${edge.from} -[${edge.type}]-> ${edge.to}`);
    }
    return;
  }

  console.log(usage());
  process.exitCode = 1;
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
