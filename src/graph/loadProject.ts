import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { AnchorsConfig, GraphConfig, YdkProject } from "./types.js";

async function readYaml<T>(filePath: string): Promise<T> {
  const source = await readFile(filePath, "utf8");
  return parse(source) as T;
}

export async function loadProject(root = process.cwd()): Promise<YdkProject> {
  const ydkRoot = path.join(root, ".ydk");

  const [graph, anchors] = await Promise.all([
    readYaml<GraphConfig>(path.join(ydkRoot, "graph.yaml")),
    readYaml<AnchorsConfig>(path.join(ydkRoot, "anchors.yaml")),
  ]);

  return {
    root,
    graph,
    anchors,
  };
}
