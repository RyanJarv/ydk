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

export type AnchorTarget = {
  kind: "file" | "filePattern" | "symbol" | string;
  path: string;
  symbol?: string;
};

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
