export type NodeId = string;

export type NodeTypeDefinition = {
  description?: string;
  root?: boolean;
  required?: boolean;
  maxCount?: number;
};

export type EdgeAllowance = {
  from: string;
  to: string;
};

export type EdgeTypeDefinition = {
  description?: string;
  allowed?: EdgeAllowance[];
};

export type ModelConfig = {
  version: number;
  model: {
    nodeTypes: Record<string, NodeTypeDefinition>;
    edgeTypes: Record<string, EdgeTypeDefinition>;
    validation?: {
      requireExactlyOneRoot?: boolean;
      requireAllNodesReachRoot?: boolean;
      requireAllAnchorsResolve?: boolean;
      allowCycles?: boolean;
    };
  };
};

export type GraphNode = {
  id: NodeId;
  type: string;
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
  model: ModelConfig;
  graph: GraphConfig;
  anchors: AnchorsConfig;
};

export type TraceStep = {
  node: GraphNode;
  via?: GraphEdge;
};
