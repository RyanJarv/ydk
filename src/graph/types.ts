export type NodeId = string;

export type GraphNode = {
  id: NodeId;
  type: "mission" | "outcome" | "capability" | "feature" | string;
  title: string;
  statement?: string;
};

export type GraphEdge = {
  from: NodeId;
  to: NodeId;
  type: string;
};

export type GraphConfig = {
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type PathTargetKind = "file" | "filePattern" | "directory";

export type PathAnchorTarget = {
  kind: PathTargetKind;
  value: string;
};

export type PackageScriptAnchorTarget = {
  kind: "packageScript";
  value: {
    path: string;
    script: string;
  };
};

export type SymbolAnchorTarget = {
  kind: "symbol";
  value: {
    path: string;
    symbol: string;
  };
};

export type CustomAnchorTarget = {
  kind: string;
  value: unknown;
};

export type AnchorTarget =
  | PathAnchorTarget
  | PackageScriptAnchorTarget
  | SymbolAnchorTarget
  | CustomAnchorTarget;

export type Anchor = {
  target: AnchorTarget;
  node: NodeId;
  reason: string;
};

export type AnchorsConfig = {
  version: number;
  anchors: Anchor[];
};

export type YdkProject = {
  root: string;
  graph: GraphConfig;
  anchors: AnchorsConfig;
};

export type TraceStep = {
  node: GraphNode;
  via?: GraphEdge;
};
