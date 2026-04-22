import fs from "node:fs";
import path from "node:path";
import type { Anchor, YdkProject } from "./types.js";

type TargetMatch = {
  anchor: Anchor;
  specificity: number;
  display: string;
  matchedPattern?: string;
};

export type TargetResolution = {
  anchor: Anchor;
  display: string;
  matchedPattern?: string;
};

export interface TargetTypeResolver {
  kind: string;
  match(project: YdkProject, anchor: Anchor, normalizedTarget: string): TargetMatch | null;
  validate(project: YdkProject, anchor: Anchor): string[];
  format(anchor: Anchor): string;
}

export interface TargetResolver {
  resolve(target: string): TargetResolution | null;
  validate(): string[];
}

const targetTypes: TargetTypeResolver[] = [
  {
    kind: "file",
    match(_project, anchor, normalizedTarget) {
      const value = stringTargetValue(anchor);
      if (!value || normalizeTarget(value) !== normalizedTarget) {
        return null;
      }

      return {
        anchor,
        display: fileTargetDisplay(anchor),
        specificity: 100,
      };
    },
    validate(project, anchor) {
      const value = stringTargetValue(anchor);
      if (!value) {
        return [`Anchor ${formatAnchorTarget(anchor)} has invalid file target value`];
      }

      const targetPath = resolveProjectPath(project.root, value);
      return isFile(targetPath)
        ? []
        : [`Anchor ${formatAnchorTarget(anchor)} references missing file: ${value}`];
    },
    format: fileTargetDisplay,
  },
  {
    kind: "packageScript",
    match(_project, anchor, normalizedTarget) {
      const value = packageScriptTargetValue(anchor);
      const parsed = parsePackageScriptTarget(normalizedTarget);
      if (
        !value ||
        parsed === null ||
        normalizeTarget(value.path) !== parsed.path ||
        value.script !== parsed.symbol
      ) {
        return null;
      }

      return {
        anchor,
        display: packageScriptTargetDisplay(anchor),
        specificity: 90,
      };
    },
    validate(project, anchor) {
      const value = packageScriptTargetValue(anchor);
      if (!value) {
        return [`Anchor ${formatAnchorTarget(anchor)} has invalid package script target value`];
      }

      const targetPath = resolveProjectPath(project.root, value.path);
      if (!isFile(targetPath)) {
        return [`Anchor ${formatAnchorTarget(anchor)} references missing package file: ${value.path}`];
      }

      const packageScripts = readPackageScripts(targetPath);
      if (packageScripts.error) {
        return [`Anchor ${formatAnchorTarget(anchor)} references unreadable package file: ${value.path}`];
      }

      return value.script in packageScripts.scripts
        ? []
        : [`Anchor ${formatAnchorTarget(anchor)} references missing package script: ${value.path}#${value.script}`];
    },
    format: packageScriptTargetDisplay,
  },
  {
    kind: "directory",
    match(_project, anchor, normalizedTarget) {
      const value = stringTargetValue(anchor);
      if (!value || !matchesDirectory(normalizedTarget, value)) {
        return null;
      }

      return {
        anchor,
        display: directoryTargetDisplay(anchor),
        specificity: 50,
      };
    },
    validate(project, anchor) {
      const value = stringTargetValue(anchor);
      if (!value) {
        return [`Anchor ${formatAnchorTarget(anchor)} has invalid directory target value`];
      }

      const targetPath = resolveProjectPath(project.root, value);
      return isDirectory(targetPath)
        ? []
        : [`Anchor ${formatAnchorTarget(anchor)} references missing directory: ${value}`];
    },
    format: directoryTargetDisplay,
  },
  {
    kind: "filePattern",
    match(_project, anchor, normalizedTarget) {
      const value = stringTargetValue(anchor);
      if (!value || !matchesPattern(normalizedTarget, value)) {
        return null;
      }

      return {
        anchor,
        display: filePatternTargetDisplay(anchor),
        specificity: 10 + patternSpecificity(value),
        matchedPattern: value,
      };
    },
    validate() {
      return [];
    },
    format: filePatternTargetDisplay,
  },
];

export function createTargetResolver(project: YdkProject): TargetResolver {
  return {
    resolve(target: string): TargetResolution | null {
      return resolveTarget(project, target);
    },
    validate(): string[] {
      return validateTargets(project);
    },
  };
}

function resolveTarget(project: YdkProject, target: string): TargetResolution | null {
  const normalizedTarget = normalizeTarget(target);
  let bestMatch: TargetMatch | null = null;

  for (const anchor of project.anchors.anchors) {
    const resolver = targetTypes.find((candidate) => candidate.kind === anchor.target.kind);
    const match = resolver?.match(project, anchor, normalizedTarget) ?? null;
    if (!match) {
      continue;
    }

    if (!bestMatch || match.specificity > bestMatch.specificity) {
      bestMatch = match;
    }
  }

  return bestMatch
    ? {
        anchor: bestMatch.anchor,
        display: bestMatch.display,
        matchedPattern: bestMatch.matchedPattern,
      }
    : null;
}

function validateTargets(project: YdkProject): string[] {
  const errors: string[] = [];

  for (const anchor of project.anchors.anchors) {
    const resolver = targetTypes.find((candidate) => candidate.kind === anchor.target.kind);
    if (resolver) {
      errors.push(...resolver.validate(project, anchor));
    }
  }

  return errors;
}

export function formatAnchorTarget(anchor: Anchor): string {
  const resolver = targetTypes.find((candidate) => candidate.kind === anchor.target.kind);
  return resolver?.format(anchor) ?? `${anchor.target.kind}:${JSON.stringify(anchor.target.value)}`;
}

function fileTargetDisplay(anchor: Anchor): string {
  return normalizeTarget(stringTargetValue(anchor) ?? "");
}

function directoryTargetDisplay(anchor: Anchor): string {
  return trimTrailingSlash(normalizeTarget(stringTargetValue(anchor) ?? ""));
}

function filePatternTargetDisplay(anchor: Anchor): string {
  return normalizeTarget(stringTargetValue(anchor) ?? "");
}

function packageScriptTargetDisplay(anchor: Anchor): string {
  const value = packageScriptTargetValue(anchor);
  return value ? `${normalizeTarget(value.path)}#${value.script}` : "";
}

function normalizeTarget(target: string): string {
  return target.replace(/\\/g, "/");
}

function stringTargetValue(anchor: Anchor): string | null {
  return typeof anchor.target.value === "string" ? anchor.target.value : null;
}

function packageScriptTargetValue(anchor: Anchor): { path: string; script: string } | null {
  const value = anchor.target.value;
  if (
    value &&
    typeof value === "object" &&
    "path" in value &&
    "script" in value &&
    typeof value.path === "string" &&
    typeof value.script === "string"
  ) {
    return {
      path: value.path,
      script: value.script,
    };
  }

  return null;
}

function resolveProjectPath(root: string, targetPath: string): string {
  return path.resolve(root, targetPath);
}

function parsePackageScriptTarget(target: string): { path: string; symbol: string } | null {
  const separator = target.indexOf("#");
  if (separator < 0) {
    return null;
  }

  const pathPart = target.slice(0, separator);
  const symbol = target.slice(separator + 1);
  if (!pathPart || !symbol) {
    return null;
  }

  return {
    path: pathPart,
    symbol,
  };
}

function matchesDirectory(target: string, directory: string): boolean {
  const normalizedDirectory = trimTrailingSlash(normalizeTarget(directory));
  return target === normalizedDirectory || target.startsWith(`${normalizedDirectory}/`);
}

function matchesPattern(target: string, pattern: string): boolean {
  return globToRegExp(normalizeTarget(pattern)).test(target);
}

function patternSpecificity(pattern: string): number {
  return normalizeTarget(pattern).replace(/\*/g, "").length;
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.replace(/\/+$/u, "") : value;
}

function isFile(targetPath: string): boolean {
  return fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
}

function isDirectory(targetPath: string): boolean {
  return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
}

function readPackageScripts(packageJsonPath: string): {
  error?: string;
  scripts: Record<string, string>;
} {
  try {
    const content = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts;

    if (!scripts || typeof scripts !== "object") {
      return { scripts: {} };
    }

    return {
      scripts: Object.fromEntries(
        Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    };
  } catch {
    return {
      error: "invalid package.json",
      scripts: {},
    };
  }
}

function escapeRegExp(value: string | undefined): string {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
