import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { AnchorsConfig, GraphConfig, ModelConfig, YdkProject } from "./types.js";

async function readYaml<T>(filePath: string): Promise<T> {
  const source = await readFile(filePath, "utf8");
  return parse(source) as T;
}

export async function loadProject(root = process.cwd()): Promise<YdkProject> {
  const ydkRoot = path.join(root, ".ydk");

  const [model, graph, anchors] = await Promise.all([
    readYaml<ModelConfig>(path.join(ydkRoot, "model.yaml")),
    readYaml<GraphConfig>(path.join(ydkRoot, "graph.yaml")),
    readYaml<AnchorsConfig>(path.join(ydkRoot, "anchors.yaml")),
  ]);

  return {
    root,
    model,
    graph,
    anchors,
  };
}
