import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { AnchorsConfig, AssessmentsConfig, GraphConfig, YdkProject } from "./types.ts";

async function readYaml<T>(filePath: string): Promise<T> {
  const source = await readFile(filePath, "utf8");
  return parse(source) as T;
}

function emptyAssessments(): AssessmentsConfig {
  return {
    version: 1,
    assessments: [],
  };
}

/** Assessments are optional, so an absent file loads as an empty set instead of failing. */
async function readAssessments(filePath: string): Promise<AssessmentsConfig> {
  let parsed: unknown;

  try {
    parsed = await readYaml<unknown>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyAssessments();
    }

    throw error;
  }

  if (parsed === null || parsed === undefined) {
    return emptyAssessments();
  }

  const config = parsed as Partial<AssessmentsConfig>;
  if (typeof parsed !== "object" || !Array.isArray(config.assessments)) {
    throw new Error(`${filePath} must contain an assessments list`);
  }

  return {
    version: config.version ?? 1,
    assessments: config.assessments,
  };
}

export async function loadProject(root = process.cwd()): Promise<YdkProject> {
  const ydkRoot = path.join(root, ".ydk");

  const [graph, anchors, assessments] = await Promise.all([
    readYaml<GraphConfig>(path.join(ydkRoot, "graph.yaml")),
    readYaml<AnchorsConfig>(path.join(ydkRoot, "anchors.yaml")),
    readAssessments(path.join(ydkRoot, "assessments.yaml")),
  ]);

  return {
    root,
    graph,
    anchors,
    assessments,
  };
}
