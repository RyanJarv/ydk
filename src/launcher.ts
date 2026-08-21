#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELP_ARGUMENTS = new Set(["--help", "-h", "help"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] !== "serve" || args.slice(1).some((arg) => HELP_ARGUMENTS.has(arg))) {
    await import("./cli.ts");
    return;
  }

  launchServeSandbox(args);
}

function launchServeSandbox(args: string[]): void {
  if (process.permission && !process.permission.has("child")) {
    throw new Error(
      "ydk serve needs permission to start its restricted server process; restart Node with --allow-child-process",
    );
  }

  const nodeMajor = Number.parseInt(process.versions.node, 10);
  const launcherPath = fileURLToPath(import.meta.url);
  const cliPath = path.join(path.dirname(launcherPath), "cli.ts");
  const readRoots = new Set([
    realpathSync(process.cwd()),
    realpathSync(path.resolve(path.dirname(launcherPath), "..")),
  ]);
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.NODE_OPTIONS;

  const result = spawnSync(
    process.execPath,
    [
      "--permission",
      ...[...readRoots].map((root) => `--allow-fs-read=${root}/*`),
      ...(nodeMajor >= 25 ? ["--allow-net"] : []),
      cliPath,
      ...args,
    ],
    { env: childEnv, stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
