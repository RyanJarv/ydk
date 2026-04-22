#!/usr/bin/env node
import { loadProject } from "./graph/loadProject.js";
import { resolveWhy } from "./graph/resolveWhy.js";
import { serveProject } from "./serve/server.js";
import { traceToRoot } from "./graph/trace.js";
import { validateProject } from "./graph/validateProject.js";

function usage(): string {
  return [
    "Usage:",
    "  ydk why <artifact-path>",
    "  ydk trace <node-id>",
    "  ydk validate",
    "  ydk graph",
    "  ydk serve [--host <host>] [--port <port>]",
  ].join("\n");
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
  const [command, value] = process.argv.slice(2);

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
