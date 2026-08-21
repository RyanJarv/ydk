import fs from "node:fs";
import path from "node:path";
import {
  anchorMatchesFile,
  formatAnchorTarget,
  matchesFilePattern,
  packageScriptTargetValue,
  readPackageScripts,
  stringTargetValue,
} from "./targetResolver.ts";
import type { Anchor, NodeId, YdkProject } from "./types.ts";

export type DirectoryCoverage = {
  path: string;
  totalFiles: number;
  anchoredFiles: number;
  children: DirectoryCoverage[];
};

export type StaleAnchor = {
  display: string;
  node: NodeId;
  reason: string;
};

export type CoverageReport = {
  anchorableNodeCount: number;
  anchoredNodeCount: number;
  unanchoredNodes: Array<{ id: NodeId; type: string; title: string }>;
  totalFiles: number;
  anchoredFiles: number;
  directories: DirectoryCoverage[];
  staleAnchors: StaleAnchor[];
};

export type AnchorStatus = {
  matchCount?: number;
  stale?: boolean;
  reason?: string;
};

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", ".ydk"]);
const ANCHORABLE_NODE_TYPES = new Set(["capability", "feature"]);
const ROOT_DIRECTORY_PATH = ".";

export function listProjectFiles(project: YdkProject): string[] {
  const ignorePatterns = readIgnorePatterns(project.root);
  const files: string[] = [];

  collectFiles(project.root, "", ignorePatterns, files);

  return files.sort(comparePaths);
}

export function computeAnchorStatus(project: YdkProject, anchor: Anchor, files: string[]): AnchorStatus {
  switch (anchor.target.kind) {
    case "file": {
      const value = stringTargetValue(anchor);
      if (value === null) {
        return { stale: true, reason: "target value is not a path" };
      }

      return isFile(path.resolve(project.root, value)) ? {} : { stale: true, reason: "file not found" };
    }
    case "directory": {
      const value = stringTargetValue(anchor);
      if (value === null) {
        return { stale: true, reason: "target value is not a path" };
      }

      return isDirectory(path.resolve(project.root, value))
        ? {}
        : { stale: true, reason: "directory not found" };
    }
    case "filePattern": {
      const value = stringTargetValue(anchor);
      if (value === null) {
        return { matchCount: 0, stale: true, reason: "target value is not a pattern" };
      }

      const matchCount = files.filter((file) => matchesFilePattern(file, value)).length;
      return matchCount > 0
        ? { matchCount }
        : { matchCount, stale: true, reason: "pattern matches no files" };
    }
    case "packageScript": {
      const value = packageScriptTargetValue(anchor);
      if (!value) {
        return { stale: true, reason: "target value is not a package script" };
      }

      const packagePath = path.resolve(project.root, value.path);
      if (!isFile(packagePath)) {
        return { stale: true, reason: "package file not found" };
      }

      const packageScripts = readPackageScripts(packagePath);
      if (packageScripts.error) {
        return { stale: true, reason: "package file could not be read" };
      }

      return value.script in packageScripts.scripts
        ? {}
        : { stale: true, reason: "package script not found" };
    }
    default:
      return {};
  }
}

export function computeCoverage(
  project: YdkProject,
  files: string[] = listProjectFiles(project),
): CoverageReport {
  const anchors = project.anchors.anchors;
  const anchoredNodeIds = new Set(anchors.map((anchor) => anchor.node));
  const anchorableNodes = project.graph.nodes.filter((node) => ANCHORABLE_NODE_TYPES.has(node.type));
  const unanchoredNodes = anchorableNodes
    .filter((node) => !anchoredNodeIds.has(node.id))
    .map((node) => ({ id: node.id, type: node.type, title: node.title }));

  const anchoredFiles = new Set(
    files.filter((file) => anchors.some((anchor) => anchorMatchesFile(anchor, file))),
  );

  const staleAnchors: StaleAnchor[] = [];
  for (const anchor of anchors) {
    const status = computeAnchorStatus(project, anchor, files);
    if (status.stale) {
      staleAnchors.push({
        display: formatAnchorTarget(anchor),
        node: anchor.node,
        reason: status.reason ?? "anchor target is missing",
      });
    }
  }

  return {
    anchorableNodeCount: anchorableNodes.length,
    anchoredNodeCount: anchorableNodes.length - unanchoredNodes.length,
    unanchoredNodes,
    totalFiles: files.length,
    anchoredFiles: anchoredFiles.size,
    directories: buildDirectoryTree(files, anchoredFiles),
    staleAnchors,
  };
}

function collectFiles(root: string, relative: string, ignorePatterns: string[], files: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        collectFiles(root, relativePath, ignorePatterns, files);
      }
      continue;
    }

    if (entry.isFile() && !isIgnored(relativePath, ignorePatterns)) {
      files.push(relativePath);
    }
  }
}

function readIgnorePatterns(root: string): string[] {
  let source: string;
  try {
    source = fs.readFileSync(path.join(root, ".ydk", "ignore"), "utf8");
  } catch {
    return [];
  }

  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function isIgnored(filePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => matchesFilePattern(filePath, pattern));
}

type DirectoryNode = {
  path: string;
  totalFiles: number;
  anchoredFiles: number;
  children: Map<string, DirectoryNode>;
};

function buildDirectoryTree(files: string[], anchoredFiles: Set<string>): DirectoryCoverage[] {
  const roots = new Map<string, DirectoryNode>();

  for (const file of files) {
    const segments = file.split("/");
    const directories = segments.slice(0, -1);
    const anchored = anchoredFiles.has(file);

    if (directories.length === 0) {
      countFile(directoryNode(roots, ROOT_DIRECTORY_PATH, ROOT_DIRECTORY_PATH), anchored);
      continue;
    }

    let siblings = roots;
    let prefix = "";
    for (const directory of directories) {
      prefix += `${directory}/`;
      const node = directoryNode(siblings, directory, prefix);
      countFile(node, anchored);
      siblings = node.children;
    }
  }

  return toDirectoryCoverage(roots);
}

function directoryNode(siblings: Map<string, DirectoryNode>, key: string, nodePath: string): DirectoryNode {
  const existing = siblings.get(key);
  if (existing) {
    return existing;
  }

  const created: DirectoryNode = {
    path: nodePath,
    totalFiles: 0,
    anchoredFiles: 0,
    children: new Map(),
  };
  siblings.set(key, created);
  return created;
}

function countFile(node: DirectoryNode, anchored: boolean): void {
  node.totalFiles += 1;
  if (anchored) {
    node.anchoredFiles += 1;
  }
}

function toDirectoryCoverage(nodes: Map<string, DirectoryNode>): DirectoryCoverage[] {
  return [...nodes.values()]
    .map((node) => ({
      path: node.path,
      totalFiles: node.totalFiles,
      anchoredFiles: node.anchoredFiles,
      children: toDirectoryCoverage(node.children),
    }))
    .sort((left, right) => comparePaths(left.path, right.path));
}

function comparePaths(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function isFile(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
