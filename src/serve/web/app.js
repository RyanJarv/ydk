import {
  computed,
  createApp,
  inject,
  onMounted,
  onUnmounted,
  provide,
  ref,
  watch,
} from "/vendor/vue.esm-browser.prod.js";

const TYPE_ORDER = ["mission", "outcome", "capability", "feature"];
const TYPE_RANK = new Map(TYPE_ORDER.map((type, index) => [type, index]));
const COLUMN_LABELS = {
  mission: "Mission",
  outcome: "Outcomes",
  capability: "Capabilities",
  feature: "Features",
};
const ANCHORABLE_TYPES = new Set(["capability", "feature"]);
/** Anchor group key for url anchors; real directory keys are "." or end in "/". */
const SURFACE_GROUP = "product-surfaces";
const VIEWS = ["map", "explorer", "coverage"];
const DEFAULT_VIEW = "explorer";
const DEFAULT_TREE_DEPTH = 2;
const MAX_SCORE = 4;
/** Below this a node's anchored artifacts do not yet fulfill what it claims. */
const SCORE_WARNING_LEVEL = 3;
/** At or below this the anchors barely serve the claim at all. */
const SCORE_DANGER_LEVEL = 1;
/** Below this many anchors a flat list reads better than directory groups. */
const ANCHOR_GROUP_THRESHOLD = 5;
/** Keeps a keystroke from becoming a request until typing settles. */
const WHY_DEBOUNCE_MS = 250;

const NODE_SIZES = {
  mission: { width: 270, height: 100 },
  outcome: { width: 290, height: 92 },
  capability: { width: 290, height: 72 },
  feature: { width: 260, height: 44 },
};
const FALLBACK_SIZE = { width: 270, height: 66 };
const CHILD_NOUNS = {
  outcome: ["outcome", "outcomes"],
  capability: ["capability", "capabilities"],
  feature: ["feature", "features"],
};
const COLUMN_GAP = 80;
const ROW_GAP = 13;
const STAGE_TOP = 26;
const STAGE_PAD = 16;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
const MAX_FIT_SCALE = 1.6;

/* ---------------------------------------------------------------- helpers */

function percent(part, total) {
  if (!total) return 0;
  return Math.round((100 * part) / total);
}

function meterTone(value) {
  if (value === 0) return "none";
  if (value < 70) return "low";
  return "good";
}

function scoreLabel(score) {
  return "score " + score + "/" + MAX_SCORE;
}

/** Compact form for places too narrow for the word, such as a map chip. */
function scoreBadge(score) {
  return (score === null || score === undefined ? "–" : score) + "/" + MAX_SCORE;
}

function scoreTone(score) {
  if (score === null || score === undefined) return { unassessed: true };
  if (score <= SCORE_DANGER_LEVEL) return { danger: true };
  return { warn: score < SCORE_WARNING_LEVEL };
}

function anchorCountLabel(count) {
  if (count === 0) return "no anchors";
  return count + (count === 1 ? " anchor" : " anchors");
}

/** A query worth asking the resolver about: one token that reads like a path. */
function looksLikePath(query) {
  if (query.length < 3 || /\s/u.test(query)) return false;
  return query.includes("/") || /\.[A-Za-z0-9]+$/u.test(query);
}

/** Same directory grouping the CLI prints for `ydk coverage --unanchored-files`. */
function groupFilesByDirectory(files) {
  const groups = new Map();
  for (const file of files ?? []) {
    const separator = file.lastIndexOf("/");
    const directory = separator < 0 ? "." : file.slice(0, separator + 1);
    const names = groups.get(directory) ?? [];
    names.push(file.slice(separator + 1));
    groups.set(directory, names);
  }
  return [...groups.entries()]
    .map(([directory, names]) => ({ directory, files: names }))
    .sort((left, right) => (left.directory < right.directory ? -1 : 1));
}

function compareNodes(left, right) {
  const rank = (TYPE_RANK.get(left.type) ?? TYPE_ORDER.length) - (TYPE_RANK.get(right.type) ?? TYPE_ORDER.length);
  if (rank !== 0) return rank;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function indexNodes(nodes) {
  return new Map(nodes.map((node) => [node.id, node]));
}

function childrenByParent(nodes, edges) {
  const byId = indexNodes(nodes);
  const map = new Map();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const list = map.get(edge.to) ?? [];
    list.push(edge.from);
    map.set(edge.to, list);
  }
  for (const [key, list] of map) {
    map.set(
      key,
      list.map((id) => byId.get(id)).sort(compareNodes).map((node) => node.id),
    );
  }
  return map;
}

function parentsByChild(nodes, edges) {
  const byId = indexNodes(nodes);
  const map = new Map();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const list = map.get(edge.from) ?? [];
    list.push(edge.to);
    map.set(edge.from, list);
  }
  return map;
}

function collectDescendants(id, children, seen = new Set()) {
  const out = new Set();
  if (seen.has(id)) return out;
  seen.add(id);
  for (const childId of children.get(id) ?? []) {
    out.add(childId);
    for (const deep of collectDescendants(childId, children, seen)) {
      out.add(deep);
    }
  }
  seen.delete(id);
  return out;
}

function collectAncestors(id, parents, seen = new Set()) {
  const out = new Set();
  if (seen.has(id)) return out;
  seen.add(id);
  for (const parentId of parents.get(id) ?? []) {
    out.add(parentId);
    for (const deep of collectAncestors(parentId, parents, seen)) {
      out.add(deep);
    }
  }
  seen.delete(id);
  return out;
}

/** Per-node rollups used by the outline badges and the map subtitles. */
function buildSubtreeStats(nodes, edges) {
  const byId = indexNodes(nodes);
  const children = childrenByParent(nodes, edges);
  const stats = new Map();

  for (const node of nodes) {
    const descendants = collectDescendants(node.id, children);
    let featureCount = 0;
    let anchorTotal = node.anchors?.length ?? 0;
    for (const id of descendants) {
      const descendant = byId.get(id);
      if (!descendant) continue;
      if (descendant.type === "feature") featureCount += 1;
      anchorTotal += descendant.anchors?.length ?? 0;
    }
    stats.set(node.id, {
      childCount: (children.get(node.id) ?? []).length,
      descendantCount: descendants.size,
      featureCount,
      anchorTotal,
      anchorCount: node.anchors?.length ?? 0,
    });
  }

  return stats;
}

/** Roots are nodes nothing points at, missions first. */
function outlineRoots(nodes, edges) {
  const byId = indexNodes(nodes);
  const hasParent = new Set();
  for (const edge of edges) {
    if (byId.has(edge.from) && byId.has(edge.to)) hasParent.add(edge.from);
  }
  const roots = nodes.filter((node) => !hasParent.has(node.id));
  if (roots.length) return roots.slice().sort(compareNodes);
  const missions = nodes.filter((node) => node.type === "mission");
  return (missions.length ? missions : nodes.slice(0, 1)).slice().sort(compareNodes);
}

/**
 * Collapsible outline rooted at the mission. Nodes with several parents appear
 * under each of them, so entries carry a path-derived key alongside the node id.
 */
function buildOutline(nodes, edges, isVisible = () => true) {
  const children = childrenByParent(nodes, edges);
  const byId = indexNodes(nodes);

  function build(id, depth, key, ancestors) {
    if (ancestors.has(id) || !byId.has(id)) return null;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);

    const entries = [];
    for (const childId of children.get(id) ?? []) {
      const entry = build(childId, depth + 1, key + "/" + childId, nextAncestors);
      if (entry) entries.push(entry);
    }

    const visible = isVisible(id);
    if (!visible && entries.length === 0) return null;
    return { key, id, depth, children: entries };
  }

  const out = [];
  for (const root of outlineRoots(nodes, edges)) {
    const entry = build(root.id, 0, root.id, new Set());
    if (entry) out.push(entry);
  }
  return out;
}

function anchorDirectory(display) {
  const withoutFragment = String(display ?? "").split("#")[0];
  const index = withoutFragment.lastIndexOf("/");
  return index === -1 ? "." : withoutFragment.slice(0, index + 1);
}

function groupAnchorsByDirectory(anchors) {
  const groups = new Map();
  for (const anchor of anchors ?? []) {
    const directory = anchor.kind === "url" ? SURFACE_GROUP : anchorDirectory(anchor.display);
    const group = groups.get(directory) ?? { directory, anchors: [] };
    group.anchors.push(anchor);
    groups.set(directory, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.directory === SURFACE_GROUP || right.directory === SURFACE_GROUP) {
      return left.directory === SURFACE_GROUP ? -1 : 1;
    }
    if (right.anchors.length !== left.anchors.length) return right.anchors.length - left.anchors.length;
    return left.directory < right.directory ? -1 : 1;
  });
}

/**
 * Layered layout: one column per node type, ordered so children sit near their
 * parents (barycenter ordering, then a parent-centering sweep back to the left).
 */
function layoutGraph(nodes, edges) {
  const byId = indexNodes(nodes);
  const parents = parentsByChild(nodes, edges);
  const children = childrenByParent(nodes, edges);

  const presentTypes = [];
  for (const type of TYPE_ORDER) {
    if (nodes.some((node) => node.type === type)) presentTypes.push(type);
  }
  for (const node of nodes) {
    if (!presentTypes.includes(node.type)) presentTypes.push(node.type);
  }

  const columnIndex = new Map(presentTypes.map((type, index) => [type, index]));
  const buckets = presentTypes.map(() => []);
  for (const node of nodes.slice().sort(compareNodes)) {
    buckets[columnIndex.get(node.type)].push(node);
  }

  const placed = new Map();
  const order = new Map();

  presentTypes.forEach((type, column) => {
    const bucket = buckets[column];
    if (column > 0) {
      const withKeys = bucket.map((node, index) => {
        const positions = (parents.get(node.id) ?? [])
          .map((parentId) => order.get(parentId))
          .filter((value) => value !== undefined);
        const barycenter = positions.length
          ? positions.reduce((sum, value) => sum + value, 0) / positions.length
          : Number.POSITIVE_INFINITY;
        return { node, index, barycenter };
      });
      withKeys.sort((left, right) =>
        left.barycenter === right.barycenter ? left.index - right.index : left.barycenter - right.barycenter,
      );
      buckets[column] = withKeys.map((entry) => entry.node);
    }
    buckets[column].forEach((node, index) => order.set(node.id, index));
  });

  const size = (node) => NODE_SIZES[node.type] ?? FALLBACK_SIZE;

  let x = 0;
  const columns = presentTypes.map((type, column) => {
    const width = size({ type }).width;
    const meta = { type, label: COLUMN_LABELS[type] ?? type, x, width, count: buckets[column].length };
    x += width + COLUMN_GAP;
    return meta;
  });

  // Downward sweep: children follow the vertical position of their parents.
  presentTypes.forEach((type, column) => {
    let cursor = STAGE_TOP;
    for (const node of buckets[column]) {
      const height = size(node).height;
      const anchors = (parents.get(node.id) ?? [])
        .map((parentId) => placed.get(parentId))
        .filter(Boolean);
      const desired = anchors.length
        ? anchors.reduce((sum, box) => sum + box.y + box.height / 2, 0) / anchors.length - height / 2
        : cursor;
      const y = Math.max(cursor, desired);
      placed.set(node.id, { node, x: columns[column].x, y, width: columns[column].width, height });
      cursor = y + height + ROW_GAP;
    }
  });

  // Upward sweep: parents centre on the children they explain.
  for (let column = presentTypes.length - 2; column >= 0; column -= 1) {
    let cursor = STAGE_TOP;
    for (const node of buckets[column]) {
      const box = placed.get(node.id);
      const anchors = (children.get(node.id) ?? [])
        .map((childId) => placed.get(childId))
        .filter(Boolean);
      const desired = anchors.length
        ? anchors.reduce((sum, child) => sum + child.y + child.height / 2, 0) / anchors.length - box.height / 2
        : box.y;
      box.y = Math.max(cursor, desired);
      cursor = box.y + box.height + ROW_GAP;
    }
  }

  const boxes = [...placed.values()];
  const minY = boxes.length ? Math.min(...boxes.map((box) => box.y)) : STAGE_TOP;
  const shift = STAGE_TOP - minY;
  for (const box of boxes) box.y += shift;

  const laidEdges = [];
  for (const edge of edges) {
    const child = placed.get(edge.from);
    const parent = placed.get(edge.to);
    if (!child || !parent || !byId.has(edge.from) || !byId.has(edge.to)) continue;
    const startX = parent.x + parent.width;
    const startY = parent.y + parent.height / 2;
    const endX = child.x;
    const endY = child.y + child.height / 2;
    const midX = (startX + endX) / 2;
    laidEdges.push({
      key: edge.from + "->" + edge.to,
      from: edge.from,
      to: edge.to,
      d: "M " + startX + " " + startY + " C " + midX + " " + startY + ", " + midX + " " + endY + ", " + endX + " " + endY,
    });
  }

  const width = columns.length ? columns[columns.length - 1].x + columns[columns.length - 1].width : 0;
  const height = boxes.length ? Math.max(...boxes.map((box) => box.y + box.height)) + STAGE_PAD : 120;

  return { columns, nodes: boxes, edges: laidEdges, width, height };
}

function parseHash(raw, hasNode) {
  const cleaned = String(raw ?? "").replace(/^#\/?/u, "");
  const [viewPart, idPart] = cleaned.split("/");
  const view = VIEWS.includes(viewPart) ? viewPart : DEFAULT_VIEW;
  const id = idPart ? decodeURIComponent(idPart) : null;
  return { view, id: id && (!hasNode || hasNode(id)) ? id : null };
}

function formatHash(view, id) {
  return id ? "#/" + view + "/" + encodeURIComponent(id) : "#/" + view;
}

/* ------------------------------------------------------------- components */

const Chevron = {
  props: { open: { type: Boolean, default: false } },
  template: `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path v-if="open" d="M3 4.5 6 7.5 9 4.5"></path>
      <path v-else d="M4.5 3 7.5 6 4.5 9"></path>
    </svg>
  `,
};

const OutlineNode = {
  name: "OutlineNode",
  props: { entry: { type: Object, required: true } },
  setup(props) {
    const tree = inject("outlineContext");
    const row = ref(null);

    function reveal() {
      if (tree.selectedId.value === props.entry.id && row.value) {
        row.value.scrollIntoView({ block: "nearest" });
      }
    }

    onMounted(reveal);
    watch(() => tree.selectedId.value, reveal, { flush: "post" });

    return { row, tree };
  },
  template: `
    <div class="tree-branch">
      <div ref="row" class="tree-row" :class="{ selected: entry.id === tree.selectedId.value }">
        <button
          v-if="entry.children.length"
          class="tree-toggle"
          type="button"
          :aria-expanded="tree.isExpanded(entry) ? 'true' : 'false'"
          :aria-label="(tree.isExpanded(entry) ? 'Collapse ' : 'Expand ') + entry.id"
          @click="tree.toggle(entry)"
        >
          <chevron :open="tree.isExpanded(entry)" />
        </button>
        <span v-else class="tree-toggle tree-dot" aria-hidden="true"><i></i></span>
        <button class="tree-label" type="button" @click="tree.select(entry.id)">
          <span class="tree-id">{{ entry.id }}</span>
          <span class="tree-title">{{ tree.nodeFor(entry.id).title }}</span>
          <span v-if="tree.badgeFor(entry).warn" class="badge warn">no anchors</span>
          <span v-else class="badge">{{ tree.badgeFor(entry).text }}</span>
        </button>
      </div>
      <div v-if="entry.children.length && tree.isExpanded(entry)" class="tree-children">
        <outline-node v-for="child in entry.children" :key="child.key" :entry="child" />
      </div>
    </div>
  `,
};

const AnchorCard = {
  name: "AnchorCard",
  props: {
    anchor: { type: Object, required: true },
    staleReason: { type: String, default: "" },
  },
  template: `
    <article class="artifact">
      <div>
        <span class="kind">{{ anchor.kind }}</span>
        <strong v-if="anchor.kind === 'url'"><a :href="anchor.display">{{ anchor.display }}</a></strong>
        <strong v-else>{{ anchor.display }}</strong>
        <span v-if="anchor.matchCount !== undefined" class="meta">matches {{ anchor.matchCount }} files</span>
      </div>
      <p>{{ anchor.reason }}</p>
      <p v-if="anchor.stale" class="stale-note">Stale &mdash; {{ staleReason }}</p>
    </article>
  `,
};

const CoverageDirectory = {
  name: "CoverageDirectory",
  props: { dir: { type: Object, required: true }, depth: { type: Number, default: 0 } },
  setup() {
    return { tree: inject("coverageContext"), meterTone };
  },
  computed: {
    ratio() {
      return percent(this.dir.anchoredFiles, this.dir.totalFiles);
    },
    label() {
      const trimmed = this.dir.path.replace(/\/$/u, "");
      if (this.dir.path === ".") return "(repository root)";
      const segments = trimmed.split("/");
      return segments[segments.length - 1] + "/";
    },
  },
  template: `
    <div class="dir-branch">
      <div class="dir-row" :class="{ top: depth === 0 }">
        <button
          v-if="dir.children.length"
          class="dir-toggle"
          type="button"
          :aria-expanded="tree.isOpen(dir.path) ? 'true' : 'false'"
          :aria-label="(tree.isOpen(dir.path) ? 'Collapse ' : 'Expand ') + dir.path"
          @click="tree.toggle(dir.path)"
        >
          <chevron :open="tree.isOpen(dir.path)" />
        </button>
        <span v-else class="dir-toggle" aria-hidden="true"></span>
        <span class="dir-name">{{ label }}</span>
        <span v-if="ratio === 0" class="badge danger">no coverage</span>
        <span v-else-if="ratio < 50" class="badge warn">low</span>
        <span class="dir-spacer"></span>
        <span class="dir-count">{{ dir.anchoredFiles }} / {{ dir.totalFiles }}</span>
        <span class="meter inline" :class="meterTone(ratio)">
          <i :style="{ width: (ratio === 0 ? 2 : ratio) + '%' }"></i>
        </span>
        <span class="dir-pct">{{ ratio }}%</span>
      </div>
      <div v-if="dir.children.length && tree.isOpen(dir.path)" class="dir-children">
        <coverage-directory v-for="child in dir.children" :key="child.path" :dir="child" :depth="depth + 1" />
      </div>
    </div>
  `,
};

const MapView = {
  name: "MapView",
  props: {
    layout: { type: Object, required: true },
    highlight: { type: Object, required: true },
    selectedId: { type: String, default: null },
    meta: { type: Map, required: true },
  },
  emits: ["select", "clear"],
  setup(props, { emit }) {
    const stage = ref(null);
    const stageSize = ref({ width: 0, height: 0 });
    const userScale = ref(null);
    const filter = ref("");
    const chips = new Map();
    let observer = null;

    onMounted(() => {
      if (!stage.value || typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect) return;
        stageSize.value = { width: rect.width, height: rect.height };
      });
      observer.observe(stage.value);
    });

    onUnmounted(() => {
      if (observer) observer.disconnect();
    });

    const fitScale = computed(() => {
      const { width, height } = stageSize.value;
      if (!width || !height || !props.layout.width || !props.layout.height) return 1;
      const scale = Math.min((width - 4) / props.layout.width, (height - 4) / props.layout.height);
      return Math.min(Math.max(scale, MIN_SCALE), MAX_FIT_SCALE);
    });

    const scale = computed(() => userScale.value ?? fitScale.value);

    function zoomBy(delta) {
      const next = Math.round((scale.value + delta) * 100) / 100;
      userScale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
    }

    function fit() {
      userScale.value = null;
    }

    function matchesFilter(node) {
      const query = filter.value.trim().toLowerCase();
      if (!query) return true;
      return (node.id + " " + node.title).toLowerCase().includes(query);
    }

    function nodeClass(node) {
      const highlight = props.highlight;
      const id = node.id;
      const offPath = highlight.active && !highlight.pathNodes.has(id) && !highlight.subtree.has(id);
      return {
        selected: id === props.selectedId,
        "on-path": highlight.active && id !== props.selectedId && highlight.pathNodes.has(id),
        dimmed: offPath || !matchesFilter(node),
      };
    }

    function nodeLabel(box) {
      const info = props.meta.get(box.node.id);
      const parts = [box.node.type, box.node.id, box.node.title];
      if (info?.anchorable) {
        parts.push(anchorCountLabel(info.anchorCount));
        parts.push(
          info.score === null ? "not assessed" : "score " + info.score + " of " + MAX_SCORE,
        );
      }
      return parts.join(", ");
    }

    /* ------------------------------------------------------ keyboard move */

    // Vue clears a function ref with null on re-render; the graph never loses a
    // node once loaded, so keeping the last element is both safe and simpler.
    function setChip(id, element) {
      if (element) chips.set(id, element);
    }

    function moveFocus(fromId, direction) {
      const boxes = props.layout.nodes;
      const current = boxes.find((box) => box.node.id === fromId);
      if (!current) return;

      let candidates;
      if (direction === "up" || direction === "down") {
        const forward = direction === "down";
        candidates = boxes
          .filter((box) => box.x === current.x && (forward ? box.y > current.y : box.y < current.y))
          .sort((left, right) => (forward ? left.y - right.y : right.y - left.y));
      } else {
        const columns = [...new Set(boxes.map((box) => box.x))].sort((left, right) => left - right);
        const targetX = columns[columns.indexOf(current.x) + (direction === "right" ? 1 : -1)];
        if (targetX === undefined) return;
        const centre = current.y + current.height / 2;
        candidates = boxes
          .filter((box) => box.x === targetX)
          .sort(
            (left, right) =>
              Math.abs(left.y + left.height / 2 - centre) - Math.abs(right.y + right.height / 2 - centre),
          );
      }

      chips.get(candidates[0]?.node.id)?.focus();
    }

    function onNodeKey(event, id) {
      const moves = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      if (moves[event.key]) {
        event.preventDefault();
        moveFocus(id, moves[event.key]);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        emit("select", id);
        return;
      }
      if (event.key === "Escape") {
        emit("clear");
      }
    }

    function edgeClass(edge) {
      const highlight = props.highlight;
      if (!highlight.active) return {};
      if (highlight.primaryEdges.has(edge.key)) return { primary: true };
      if (highlight.altEdges.has(edge.key)) return { alternate: true };
      const inSubtree = highlight.subtree.has(edge.from) && highlight.subtree.has(edge.to);
      return { dimmed: !inSubtree };
    }

    return {
      edgeClass,
      filter,
      fit,
      nodeClass,
      nodeLabel,
      onNodeKey,
      scale,
      scoreBadge,
      scoreTone,
      setChip,
      stage,
      zoomBy,
    };
  },
  template: `
    <section class="card map-card">
      <div class="map-toolbar">
        <div class="map-filter">
          <input
            v-model="filter"
            type="search"
            placeholder="Find a node"
            aria-label="Filter map nodes by id or title"
            @keydown.esc.prevent="filter = ''"
          >
        </div>
        <div class="legend">
          <span>
            <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><path d="M1 4 H21" stroke="#2e7d5b" stroke-width="2.5" fill="none" stroke-linecap="round"></path></svg>
            Why path
          </span>
          <span>
            <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><path d="M1 4 H21" stroke="#8fb39b" stroke-width="2" stroke-dasharray="5 4" fill="none" stroke-linecap="round"></path></svg>
            Alternate path
          </span>
          <span>
            <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><path d="M1 4 H21" stroke="#d3ddd4" stroke-width="1.5" fill="none" stroke-linecap="round"></path></svg>
            supports
          </span>
        </div>
        <div class="map-controls">
          <button v-if="highlight.active" class="chip focus-chip" type="button" @click="$emit('clear')">
            Focus: {{ selectedId }}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 2 8 8 M8 2 2 8"></path></svg>
          </button>
          <div class="zoom">
            <button type="button" aria-label="Zoom out" @click="zoomBy(-0.1)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 6 H10"></path></svg>
            </button>
            <span class="zoom-level">{{ Math.round(scale * 100) }}%</span>
            <button type="button" aria-label="Zoom in" @click="zoomBy(0.1)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 6 H10 M6 2 V10"></path></svg>
            </button>
            <button type="button" class="zoom-fit" @click="fit()">Fit</button>
          </div>
        </div>
      </div>

      <p class="map-hint">
        <kbd>&#8592;</kbd><kbd>&#8593;</kbd><kbd>&#8594;</kbd><kbd>&#8595;</kbd> move between nodes
        &middot; <kbd>Enter</kbd> open the node &middot; <kbd>Esc</kbd> clear focus
      </p>

      <div
        ref="stage"
        class="map-stage"
        :style="{ maxHeight: (layout.height + 24) + 'px' }"
        @click.self="$emit('clear')"
      >
        <p v-if="!layout.nodes.length" class="message muted">No purpose nodes to map yet.</p>
        <svg
          v-else
          class="map-svg"
          :width="layout.width * scale"
          :height="layout.height * scale"
          :viewBox="'0 0 ' + layout.width + ' ' + layout.height"
          @click.self="$emit('clear')"
        >
          <text v-for="column in layout.columns" :key="column.type" class="map-col-head" :x="column.x" y="14">
            {{ column.label.toUpperCase() }}<tspan v-if="column.type !== 'mission'"> &#183; {{ column.count }}</tspan>
          </text>
          <path
            v-for="edge in layout.edges"
            :key="edge.key"
            class="map-edge"
            :class="edgeClass(edge)"
            :d="edge.d"
          ></path>
          <foreignObject
            v-for="box in layout.nodes"
            :key="box.node.id"
            :x="box.x"
            :y="box.y"
            :width="box.width"
            :height="box.height"
          >
            <div
              :ref="(element) => setChip(box.node.id, element)"
              class="map-node"
              :class="[box.node.type, nodeClass(box.node)]"
              role="button"
              tabindex="0"
              :aria-label="nodeLabel(box)"
              :title="box.node.id + ' ' + box.node.title"
              @click="$emit('select', box.node.id)"
              @keydown="onNodeKey($event, box.node.id)"
            >
              <template v-if="meta.get(box.node.id).anchorable">
                <span class="map-node-head">
                  <span class="map-node-id">{{ box.node.id }}</span>
                  <span
                    class="map-node-anchors"
                    :class="{ warn: meta.get(box.node.id).anchorCount === 0 }"
                  >{{ meta.get(box.node.id).countText }}</span>
                  <span class="badge map-node-score" :class="scoreTone(meta.get(box.node.id).score)">
                    {{ scoreBadge(meta.get(box.node.id).score) }}
                  </span>
                </span>
                <span class="map-node-title">{{ box.node.title }}</span>
              </template>
              <template v-else>
                <span class="map-node-id">{{ box.node.id }}</span>
                <span class="map-node-title">{{ box.node.title }}</span>
                <span v-if="meta.get(box.node.id).summary" class="map-node-meta">
                  {{ meta.get(box.node.id).summary }}
                </span>
              </template>
            </div>
          </foreignObject>
        </svg>
      </div>
    </section>
  `,
};

/* -------------------------------------------------------------------- app */

const App = {
  setup() {
    const project = ref(null);
    const validation = ref(null);
    const loading = ref(true);
    const error = ref("");

    const view = ref(DEFAULT_VIEW);
    const selectedId = ref(null);
    const explicitSelection = ref(false);

    const search = ref("");
    const unanchoredOnly = ref(false);
    const kindFilter = ref("any");
    const expandedOverrides = ref({});
    const allCollapsed = ref(false);
    const showAllPaths = ref(false);
    const showIndex = ref(false);
    const openAnchorGroups = ref({});
    const openDirectories = ref({});

    const nodes = computed(() => project.value?.nodes ?? []);
    const edges = computed(() => project.value?.edges ?? []);
    const anchors = computed(() => project.value?.anchors ?? []);
    const stats = computed(
      () =>
        project.value?.stats ?? {
          nodeCount: 0,
          edgeCount: 0,
          anchorCount: 0,
          anchorableNodeCount: 0,
          anchoredNodeCount: 0,
        },
    );
    const coverage = computed(
      () =>
        project.value?.coverage ?? {
          anchorableNodeCount: 0,
          anchoredNodeCount: 0,
          unanchoredNodes: [],
          totalFiles: 0,
          anchoredFiles: 0,
          directories: [],
          staleAnchors: [],
          assessedNodes: [],
          averageScore: null,
        },
    );

    const nodeById = computed(() => indexNodes(nodes.value));
    const parents = computed(() => parentsByChild(nodes.value, edges.value));
    const children = computed(() => childrenByParent(nodes.value, edges.value));
    const subtreeStats = computed(() => buildSubtreeStats(nodes.value, edges.value));

    const missionId = computed(
      () => nodes.value.find((node) => node.type === "mission")?.id ?? nodes.value[0]?.id ?? null,
    );
    const anchoredPercent = computed(() => percent(stats.value.anchoredNodeCount, stats.value.anchorableNodeCount));

    const selectedNode = computed(() => nodeById.value.get(selectedId.value) ?? null);

    /* ------------------------------------------------------------ routing */

    function applyHash() {
      const parsed = parseHash(window.location.hash, (id) => nodeById.value.has(id));
      view.value = parsed.view;
      if (parsed.id) {
        selectedId.value = parsed.id;
        explicitSelection.value = true;
      } else {
        selectedId.value = missionId.value;
        explicitSelection.value = false;
      }
    }

    function syncHash() {
      const next = formatHash(view.value, explicitSelection.value ? selectedId.value : null);
      if (window.location.hash !== next) window.location.hash = next;
    }

    function selectNode(id) {
      if (!nodeById.value.has(id)) return;
      selectedId.value = id;
      explicitSelection.value = true;
    }

    function openInExplorer(id) {
      view.value = "explorer";
      selectNode(id);
    }

    function setView(next) {
      view.value = next;
    }

    watch([view, selectedId, explicitSelection], syncHash);

    /* ----------------------------------------------------------- outline */

    const anchorKinds = computed(() => {
      const kinds = new Set();
      for (const anchor of anchors.value) kinds.add(anchor.kind);
      return [...kinds].sort();
    });

    const matchedIds = computed(() => {
      const query = search.value.trim().toLowerCase();
      const kind = kindFilter.value;
      const unanchored = unanchoredOnly.value;
      if (!query && kind === "any" && !unanchored) return null;

      const matches = new Set();
      for (const node of nodes.value) {
        if (query) {
          const anchorText = node.anchors.map((anchor) => anchor.display + " " + anchor.reason).join(" ");
          const haystack = [node.id, node.type, node.title, node.statement ?? "", anchorText].join(" ").toLowerCase();
          if (!haystack.includes(query)) continue;
        }
        if (kind !== "any" && !node.anchors.some((anchor) => anchor.kind === kind)) continue;
        if (unanchored && !(ANCHORABLE_TYPES.has(node.type) && node.anchors.length === 0)) continue;
        matches.add(node.id);
      }
      return matches;
    });

    const visibleIds = computed(() => {
      const matches = matchedIds.value;
      if (!matches) return null;
      const out = new Set(matches);
      for (const id of matches) {
        for (const ancestor of collectAncestors(id, parents.value)) out.add(ancestor);
      }
      return out;
    });

    const filtersActive = computed(() => visibleIds.value !== null);

    watch(filtersActive, () => {
      expandedOverrides.value = {};
      allCollapsed.value = false;
    });

    const outline = computed(() =>
      buildOutline(nodes.value, edges.value, (id) => visibleIds.value === null || visibleIds.value.has(id)),
    );

    const outlineEmpty = computed(() => outline.value.length === 0);

    function isExpanded(entry) {
      const override = expandedOverrides.value[entry.id];
      if (override !== undefined) return override;
      if (filtersActive.value) return true;
      return entry.depth < DEFAULT_TREE_DEPTH + 1;
    }

    function toggleExpanded(entry) {
      expandedOverrides.value = { ...expandedOverrides.value, [entry.id]: !isExpanded(entry) };
    }

    function toggleAll() {
      const nextValue = allCollapsed.value;
      const next = {};
      for (const node of nodes.value) next[node.id] = nextValue;
      expandedOverrides.value = next;
      allCollapsed.value = !nextValue;
    }

    // A deep link can land on a node whose branch is closed; open the way to it.
    watch(selectedId, (id) => {
      if (!id) return;
      const ancestors = collectAncestors(id, parents.value);
      let changed = false;
      const next = { ...expandedOverrides.value };
      for (const ancestor of ancestors) {
        if (next[ancestor] !== true) {
          next[ancestor] = true;
          changed = true;
        }
      }
      if (changed) expandedOverrides.value = next;
    });

    function badgeFor(entry) {
      const stat = subtreeStats.value.get(entry.id) ?? { anchorCount: 0, featureCount: 0, anchorTotal: 0 };
      const node = nodeById.value.get(entry.id);
      if (node && ANCHORABLE_TYPES.has(node.type) && stat.anchorCount === 0) {
        return { warn: true, text: "no anchors" };
      }
      if (entry.children.length) {
        return { warn: false, text: stat.featureCount + "f · " + stat.anchorTotal };
      }
      return { warn: false, text: String(stat.anchorCount) };
    }

    provide("outlineContext", {
      badgeFor,
      isExpanded,
      nodeFor: (id) => nodeById.value.get(id) ?? { id, title: id },
      select: selectNode,
      selectedId,
      toggle: toggleExpanded,
    });

    /* ------------------------------------------------------------ detail */

    function traceNodes(trace) {
      return (trace ?? []).map((id) => nodeById.value.get(id)).filter(Boolean);
    }

    const selectedTraces = computed(() => {
      const node = selectedNode.value;
      if (!node) return [];
      const traces = node.traces?.length ? node.traces : node.trace?.length ? [node.trace] : [];
      return traces.map((trace) => traceNodes(trace));
    });

    const primaryTrace = computed(() => selectedTraces.value[0] ?? []);

    const alternateSummary = computed(() => {
      const traces = selectedTraces.value;
      if (traces.length < 2) return null;
      const primaryIds = new Set((traces[0] ?? []).map((node) => node.id));
      for (const trace of traces.slice(1)) {
        const branch = trace.find((node) => !primaryIds.has(node.id));
        if (branch) return { count: traces.length, node: branch };
      }
      return { count: traces.length, node: null };
    });

    const selectedChildren = computed(() =>
      (children.value.get(selectedId.value) ?? []).map((id) => nodeById.value.get(id)).filter(Boolean),
    );

    const selectedParents = computed(() =>
      (parents.value.get(selectedId.value) ?? []).map((id) => nodeById.value.get(id)).filter(Boolean),
    );

    const selectedAssessment = computed(() => selectedNode.value?.assessment ?? null);

    const staleReasons = computed(() => {
      const map = new Map();
      for (const stale of coverage.value.staleAnchors ?? []) {
        map.set(stale.node + "::" + stale.display, stale.reason);
      }
      return map;
    });

    function staleReason(anchor) {
      return staleReasons.value.get(selectedId.value + "::" + anchor.display) ?? "anchor target is missing";
    }

    const anchorGroups = computed(() => groupAnchorsByDirectory(selectedNode.value?.anchors ?? []));

    // Few enough anchors and the directory headings cost more than they explain.
    const anchorsGrouped = computed(
      () => (selectedNode.value?.anchors ?? []).length > ANCHOR_GROUP_THRESHOLD,
    );

    function isGroupOpen(directory) {
      const key = selectedId.value + "::" + directory;
      const override = openAnchorGroups.value[key];
      if (override !== undefined) return override;
      return anchorGroups.value[0]?.directory === directory;
    }

    function toggleGroup(directory) {
      const key = selectedId.value + "::" + directory;
      openAnchorGroups.value = { ...openAnchorGroups.value, [key]: !isGroupOpen(directory) };
    }

    function groupLabel(directory) {
      if (directory === SURFACE_GROUP) return "Product surfaces";
      return directory === "." ? "(repository root)" : directory;
    }

    /* ------------------------------------------------------ why resolution */

    const whyQuery = ref("");
    const whyView = ref(null);
    const whyMissing = ref(false);
    let whyTimer = null;
    let whyRequest = 0;

    function forgetWhy() {
      whyQuery.value = "";
      whyView.value = null;
      whyMissing.value = false;
    }

    /**
     * A path the literal filter cannot place still has an explanation: pattern
     * and directory anchors cover files nothing names. Asking `/api/why` runs
     * the same resolver as the CLI, so the browser answers what the terminal would.
     */
    async function resolveWhy(query) {
      const request = ++whyRequest;
      try {
        const response = await fetch("/api/why?path=" + encodeURIComponent(query));
        if (request !== whyRequest) return;
        if (response.ok) {
          whyQuery.value = query;
          whyView.value = await response.json();
          whyMissing.value = false;
          return;
        }
        // A miss is the normal answer for a path nothing anchors, not a failure.
        whyQuery.value = query;
        whyView.value = null;
        whyMissing.value = response.status === 404;
      } catch {
        if (request === whyRequest) forgetWhy();
      }
    }

    watch([search, matchedIds], () => {
      const query = search.value.trim();
      const matches = matchedIds.value;
      if (whyTimer) clearTimeout(whyTimer);

      if (!looksLikePath(query) || !matches || matches.size > 0) {
        whyRequest += 1;
        forgetWhy();
        return;
      }
      if (whyQuery.value === query) return;

      whyTimer = setTimeout(() => resolveWhy(query), WHY_DEBOUNCE_MS);
    });

    const whyResolution = computed(() => {
      const view = whyView.value;
      if (!view) return null;
      return {
        anchor: view.anchor,
        node: nodeById.value.get(view.anchor.node) ?? null,
        query: view.query,
        // Only worth naming when the anchor is not the query typed verbatim.
        via: view.anchor.display === view.query ? null : view.anchor.display,
      };
    });

    const visibleAnchors = computed(() => {
      const query = search.value.trim().toLowerCase();
      if (!query) return anchors.value;
      return anchors.value.filter((anchor) =>
        [anchor.display, anchor.kind, anchor.reason, anchor.nodeTitle].join(" ").toLowerCase().includes(query),
      );
    });

    /* --------------------------------------------------------------- map */

    const mapLayout = computed(() => layoutGraph(nodes.value, edges.value));

    /**
     * What each map chip shows beyond its title: a rollup for the tiers that
     * only aggregate, and the node's own score and anchor count for the tiers
     * that can be anchored and assessed.
     */
    const mapNodeMeta = computed(() => {
      const meta = new Map();
      for (const node of nodes.value) {
        const stat = subtreeStats.value.get(node.id);
        const anchorCount = node.anchors?.length ?? 0;
        const anchorable = ANCHORABLE_TYPES.has(node.type);

        let summary = null;
        if ((node.type === "mission" || node.type === "outcome") && stat?.childCount) {
          const childNode = nodeById.value.get((children.value.get(node.id) ?? [])[0]);
          const nouns = CHILD_NOUNS[childNode?.type] ?? ["child", "children"];
          const noun = stat.childCount === 1 ? nouns[0] : nouns[1];
          summary = stat.childCount + " " + noun + " · " + stat.anchorTotal + " anchors";
        }

        meta.set(node.id, {
          anchorable,
          anchorCount,
          // A feature chip is one narrow row, so the word only survives where it fits.
          countText:
            anchorCount === 0 || node.type !== "feature" ? anchorCountLabel(anchorCount) : String(anchorCount),
          score: node.assessment ? node.assessment.score : null,
          summary,
        });
      }
      return meta;
    });

    const mapHighlight = computed(() => {
      const primaryEdges = new Set();
      const altEdges = new Set();
      const pathNodes = new Set();
      const subtree = new Set();
      const node = selectedNode.value;
      if (!explicitSelection.value || !node) {
        return { active: false, altEdges, pathNodes, primaryEdges, subtree };
      }

      selectedTraces.value.forEach((trace, index) => {
        trace.forEach((step, position) => {
          pathNodes.add(step.id);
          const next = trace[position + 1];
          if (!next) return;
          const key = step.id + "->" + next.id;
          if (index === 0) primaryEdges.add(key);
          else if (!primaryEdges.has(key)) altEdges.add(key);
        });
      });
      pathNodes.add(node.id);

      subtree.add(node.id);
      for (const id of collectDescendants(node.id, children.value)) subtree.add(id);

      return { active: true, altEdges, pathNodes, primaryEdges, subtree };
    });

    function clearFocus() {
      explicitSelection.value = false;
    }

    /* ---------------------------------------------------------- coverage */

    const largestDirectory = computed(() => {
      let largest = null;
      for (const directory of coverage.value.directories ?? []) {
        if (!largest || directory.totalFiles > largest.totalFiles) largest = directory;
      }
      return largest?.path ?? null;
    });

    provide("coverageContext", {
      isOpen: (path) => {
        const override = openDirectories.value[path];
        if (override !== undefined) return override;
        return path === largestDirectory.value;
      },
      toggle: (path) => {
        const override = openDirectories.value[path];
        const current = override !== undefined ? override : path === largestDirectory.value;
        openDirectories.value = { ...openDirectories.value, [path]: !current };
      },
    });

    const nodeCoverage = computed(() => ({
      anchored: coverage.value.anchoredNodeCount,
      total: coverage.value.anchorableNodeCount,
      ratio: percent(coverage.value.anchoredNodeCount, coverage.value.anchorableNodeCount),
    }));

    const fileCoverage = computed(() => ({
      anchored: coverage.value.anchoredFiles,
      total: coverage.value.totalFiles,
      ratio: percent(coverage.value.anchoredFiles, coverage.value.totalFiles),
    }));

    const unanchoredFileGroups = computed(() => groupFilesByDirectory(coverage.value.unanchoredFiles));

    function showUnanchoredFiles() {
      document.getElementById("unanchored-files")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /** Worst first: the point of the card is what needs attention. */
    const assessedNodes = computed(() =>
      (coverage.value.assessedNodes ?? [])
        .map((node) => {
          const assessment = nodeById.value.get(node.id)?.assessment;
          const findings = [];
          if (assessment?.unfulfilled.length) findings.push(assessment.unfulfilled.length + " unfulfilled");
          if (assessment?.undeclared.length) findings.push(assessment.undeclared.length + " undeclared");
          return { ...node, findings: findings.join(" · ") };
        })
        .sort((left, right) => left.score - right.score),
    );

    const assessmentSummary = computed(() => {
      if (!assessedNodes.value.length) return null;
      const average = coverage.value.averageScore;
      return {
        assessed: assessedNodes.value.length,
        total: coverage.value.anchorableNodeCount,
        average: average === null || average === undefined ? null : average.toFixed(1),
      };
    });

    /* -------------------------------------------------------------- load */

    onMounted(async () => {
      try {
        const response = await fetch("/api/project");
        if (!response.ok) throw new Error(await response.text());
        const payload = await response.json();
        project.value = payload.project;
        validation.value = payload.validation;
        applyHash();
      } catch (caught) {
        error.value = caught instanceof Error ? caught.message : String(caught);
      } finally {
        loading.value = false;
      }
      window.addEventListener("hashchange", applyHash);
    });

    onUnmounted(() => window.removeEventListener("hashchange", applyHash));

    return {
      allCollapsed,
      alternateSummary,
      anchorGroups,
      anchorKinds,
      anchoredPercent,
      anchorsGrouped,
      assessedNodes,
      assessmentSummary,
      clearFocus,
      coverage,
      error,
      fileCoverage,
      groupLabel,
      isGroupOpen,
      kindFilter,
      loading,
      mapHighlight,
      mapLayout,
      mapNodeMeta,
      meterTone,
      nodeCoverage,
      nodes,
      openInExplorer,
      outline,
      outlineEmpty,
      primaryTrace,
      project,
      scoreBadge,
      scoreLabel,
      scoreTone,
      search,
      selectNode,
      selectedAssessment,
      selectedChildren,
      selectedId,
      selectedNode,
      selectedParents,
      selectedTraces,
      setView,
      showAllPaths,
      showIndex,
      showUnanchoredFiles,
      staleReason,
      stats,
      toggleAll,
      toggleGroup,
      unanchoredFileGroups,
      unanchoredOnly,
      validation,
      view,
      visibleAnchors,
      whyMissing,
      whyQuery,
      whyResolution,
    };
  },
  template: `
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">ydk project explorer</p>
          <h1>Project Purpose Map</h1>
        </div>
        <div class="topbar-right">
          <div v-if="project" class="stats" aria-label="project stats">
            <span><strong>{{ stats.nodeCount }}</strong> nodes</span>
            <span><strong>{{ stats.anchorCount }}</strong> anchors</span>
            <span><strong>{{ stats.edgeCount }}</strong> edges</span>
            <span v-if="stats.anchorableNodeCount"><strong>{{ anchoredPercent }}%</strong> anchored</span>
          </div>
          <nav class="tabs" aria-label="views">
            <button type="button" :class="{ active: view === 'map' }" @click="setView('map')">Map</button>
            <button type="button" :class="{ active: view === 'explorer' }" @click="setView('explorer')">Explorer</button>
            <button type="button" :class="{ active: view === 'coverage' }" @click="setView('coverage')">Coverage</button>
          </nav>
        </div>
      </header>

      <p v-if="loading" class="message">Loading project graph...</p>
      <p v-else-if="error" class="message error">{{ error }}</p>

      <template v-else>
        <section v-if="validation && !validation.ok" class="validation">
          <strong>Validation issues</strong>
          <ul>
            <li v-for="issue in validation.errors" :key="issue">{{ issue }}</li>
          </ul>
        </section>

        <p v-if="!nodes.length" class="message">
          No purpose graph found. Add nodes to <strong>.ydk/graph.yaml</strong> to get started.
        </p>

        <template v-else>
          <!-- Map ------------------------------------------------------- -->
          <div v-show="view === 'map'" class="view view-map">
            <map-view
              :layout="mapLayout"
              :highlight="mapHighlight"
              :selected-id="selectedId"
              :meta="mapNodeMeta"
              @select="selectNode"
              @clear="clearFocus"
            />
          </div>

          <!-- Explorer -------------------------------------------------- -->
          <div v-show="view === 'explorer'" class="view">
            <section class="workspace">
              <aside class="navigator card" aria-label="purpose graph">
                <div class="search">
                  <input v-model="search" type="search" placeholder="Search nodes and artifacts" aria-label="Search nodes and artifacts">
                </div>

                <div v-if="whyResolution" class="resolution">
                  <div class="resolution-head">
                    <span class="resolution-label">Resolved artifact</span>
                    <span class="resolution-query">{{ whyResolution.query }}</span>
                  </div>
                  <p v-if="whyResolution.via" class="resolution-via">
                    matched via <span class="kind">{{ whyResolution.anchor.kind }}</span>
                    <strong>{{ whyResolution.via }}</strong>
                  </p>
                  <button
                    v-if="whyResolution.node"
                    type="button"
                    class="resolution-node"
                    @click="selectNode(whyResolution.node.id)"
                  >
                    <span class="node-id">{{ whyResolution.node.id }}</span>
                    <span class="list-title">{{ whyResolution.node.title }}</span>
                    <span
                      v-if="whyResolution.node.assessment"
                      class="badge"
                      :class="scoreTone(whyResolution.node.assessment.score)"
                    >{{ scoreBadge(whyResolution.node.assessment.score) }}</span>
                  </button>
                  <p class="muted resolution-reason">{{ whyResolution.anchor.reason }}</p>
                </div>

                <p v-else-if="whyMissing" class="muted resolution-miss">
                  No explanation found for <strong>{{ whyQuery }}</strong> &mdash; no anchor reaches it.
                </p>

                <div class="filters">
                  <button
                    type="button"
                    class="chip"
                    :class="{ active: unanchoredOnly }"
                    :aria-pressed="unanchoredOnly ? 'true' : 'false'"
                    @click="unanchoredOnly = !unanchoredOnly"
                  >
                    Unanchored only
                  </button>
                  <label class="chip chip-select">
                    Kind:
                    <select v-model="kindFilter" aria-label="Filter by anchor kind">
                      <option value="any">any</option>
                      <option v-for="kind in anchorKinds" :key="kind" :value="kind">{{ kind }}</option>
                    </select>
                  </label>
                  <button type="button" class="chip chip-quiet" @click="toggleAll()">
                    {{ allCollapsed ? 'Expand all' : 'Collapse all' }}
                  </button>
                </div>

                <div class="tree">
                  <p v-if="outlineEmpty" class="muted empty">Nothing matches these filters.</p>
                  <outline-node v-for="entry in outline" :key="entry.key" :entry="entry" />
                </div>
              </aside>

              <section v-if="selectedNode" class="detail card">
                <div class="detail-header">
                  <div>
                    <p class="eyebrow">{{ selectedNode.type }}</p>
                    <h2>{{ selectedNode.title }}</h2>
                  </div>
                  <div class="detail-badges">
                    <span
                      v-if="selectedAssessment"
                      class="badge"
                      :class="scoreTone(selectedAssessment.score)"
                      :title="'Assessed ' + selectedAssessment.assessed"
                    >
                      {{ scoreLabel(selectedAssessment.score) }}
                    </span>
                    <span class="node-pill">{{ selectedNode.id }}</span>
                  </div>
                </div>

                <p v-if="selectedNode.statement" class="statement">{{ selectedNode.statement }}</p>

                <!-- Anchors lead: everything below explains the artifacts named here. -->
                <section class="artifacts">
                  <div class="section-head">
                    <h3>Anchored Artifacts</h3>
                    <span v-if="selectedNode.anchors.length" class="muted">
                      <template v-if="anchorsGrouped">
                        {{ selectedNode.anchors.length }} across {{ anchorGroups.length }} {{ anchorGroups.length === 1 ? 'directory' : 'directories' }}
                      </template><template v-else>
                        {{ selectedNode.anchors.length === 1 ? '1 anchor' : selectedNode.anchors.length + ' anchors' }}
                      </template>
                    </span>
                    <span class="muted section-note">The artifacts this node claims.</span>
                  </div>

                  <template v-if="anchorsGrouped">
                    <div v-for="group in anchorGroups" :key="group.directory" class="artifact-group">
                      <button type="button" class="group-header" @click="toggleGroup(group.directory)">
                        <chevron :open="isGroupOpen(group.directory)" />
                        <span>{{ groupLabel(group.directory) }}</span>
                        <span class="badge">{{ group.anchors.length }}</span>
                      </button>
                      <div v-if="isGroupOpen(group.directory)" class="group-body">
                        <anchor-card
                          v-for="anchor in group.anchors"
                          :key="anchor.display"
                          :anchor="anchor"
                          :stale-reason="anchor.stale ? staleReason(anchor) : ''"
                        />
                      </div>
                    </div>
                  </template>

                  <div v-else-if="selectedNode.anchors.length" class="group-body flat">
                    <anchor-card
                      v-for="anchor in selectedNode.anchors"
                      :key="anchor.display"
                      :anchor="anchor"
                      :stale-reason="anchor.stale ? staleReason(anchor) : ''"
                    />
                  </div>

                  <p v-else class="muted">No artifacts anchor directly to this node.</p>
                </section>

                <section class="trace">
                  <h3>Why Path</h3>
                  <div class="why-path">
                    <template v-for="(step, index) in primaryTrace" :key="step.id">
                      <svg v-if="index" class="why-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none"
                        stroke="#8fb39b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 7h8M8 3.5 11.5 7 8 10.5"></path>
                      </svg>
                      <button
                        type="button"
                        class="why-chip"
                        :class="{ active: step.id === selectedNode.id }"
                        @click="selectNode(step.id)"
                      >
                        <strong>{{ step.id }}</strong> {{ step.title }}
                      </button>
                    </template>
                    <p v-if="!primaryTrace.length" class="muted">No path to the mission from this node.</p>
                  </div>

                  <p v-if="alternateSummary" class="path-note">
                    {{ alternateSummary.count }} paths reach the mission<template v-if="alternateSummary.node">
                      &mdash; also via <strong class="node-id">{{ alternateSummary.node.id }}</strong>
                      {{ alternateSummary.node.title }}</template>
                    &middot;
                    <button type="button" class="link-button" @click="showAllPaths = !showAllPaths">
                      {{ showAllPaths ? 'Hide all paths' : 'Show all paths' }}
                    </button>
                  </p>

                  <div v-if="alternateSummary && showAllPaths" class="alt-paths">
                    <div v-for="(trace, traceIndex) in selectedTraces" :key="'path-' + traceIndex" class="alt-path">
                      <span class="alt-path-label">{{ traceIndex === 0 ? 'primary' : 'alt ' + traceIndex }}</span>
                      <template v-for="(step, index) in trace" :key="step.id + '-' + index">
                        <span v-if="index" class="alt-path-sep">&rsaquo;</span>
                        <button
                          type="button"
                          class="why-chip small"
                          :class="{ active: step.id === selectedNode.id }"
                          @click="selectNode(step.id)"
                        >
                          <strong>{{ step.id }}</strong> {{ step.title }}
                        </button>
                      </template>
                    </div>
                  </div>
                </section>

                <section class="relationships">
                  <div>
                    <h3>Supported By</h3>
                    <button v-for="node in selectedChildren" :key="node.id" type="button" @click="selectNode(node.id)">
                      <strong class="node-id">{{ node.id }}</strong> {{ node.title }}
                    </button>
                    <p v-if="!selectedChildren.length" class="muted">No child nodes.</p>
                  </div>
                  <div>
                    <h3>Supports</h3>
                    <button v-for="node in selectedParents" :key="node.id" type="button" @click="selectNode(node.id)">
                      <strong class="node-id">{{ node.id }}</strong> {{ node.title }}
                    </button>
                    <p v-if="!selectedParents.length" class="muted">This is the top-level mission.</p>
                  </div>
                </section>

                <section v-if="selectedAssessment" class="assessment">
                  <div class="section-head">
                    <h3>Assessment</h3>
                    <span class="badge" :class="scoreTone(selectedAssessment.score)">
                      {{ scoreLabel(selectedAssessment.score) }}
                    </span>
                    <span class="muted">assessed {{ selectedAssessment.assessed }}</span>
                  </div>
                  <p class="muted">
                    How well the artifacts above fulfill what this node claims. Judged on direct anchors only.
                  </p>

                  <div v-if="selectedAssessment.unfulfilled.length">
                    <h4>Claimed but not delivered</h4>
                    <ul class="finding-list">
                      <li v-for="finding in selectedAssessment.unfulfilled" :key="finding">{{ finding }}</li>
                    </ul>
                  </div>

                  <div v-if="selectedAssessment.undeclared.length">
                    <h4>Delivered but not claimed</h4>
                    <ul class="finding-list">
                      <li v-for="finding in selectedAssessment.undeclared" :key="finding">{{ finding }}</li>
                    </ul>
                  </div>
                </section>
              </section>
            </section>

            <section class="artifact-index card">
              <button type="button" class="index-toggle" @click="showIndex = !showIndex">
                <chevron :open="showIndex" />
                <h2>Artifact Index</h2>
                <span class="badge">{{ visibleAnchors.length }}</span>
              </button>
              <div v-if="showIndex" class="artifact-grid">
                <button
                  v-for="anchor in visibleAnchors"
                  :key="anchor.display + anchor.node"
                  type="button"
                  class="artifact compact"
                  @click="selectNode(anchor.node)"
                >
                  <span class="kind">{{ anchor.kind }}</span>
                  <strong>{{ anchor.display }}</strong>
                  <small>{{ anchor.node }} {{ anchor.nodeTitle }}</small>
                </button>
                <p v-if="!visibleAnchors.length" class="muted">No artifacts match this search.</p>
              </div>
            </section>
          </div>

          <!-- Coverage -------------------------------------------------- -->
          <div v-show="view === 'coverage'" class="view">
            <section class="tiles">
              <article class="tile card">
                <span class="tile-label">Capabilities and features anchored</span>
                <span class="tile-value">
                  {{ nodeCoverage.anchored }}
                  <small>/ {{ nodeCoverage.total }} &middot; {{ nodeCoverage.ratio }}%</small>
                </span>
                <span class="meter" :class="meterTone(nodeCoverage.ratio)">
                  <i :style="{ width: (nodeCoverage.ratio === 0 ? 2 : nodeCoverage.ratio) + '%' }"></i>
                </span>
              </article>
              <article class="tile card">
                <span class="tile-label">Repository files anchored</span>
                <span class="tile-value">
                  {{ fileCoverage.anchored }}
                  <small>/ {{ fileCoverage.total }} &middot; {{ fileCoverage.ratio }}%</small>
                </span>
                <span class="meter" :class="meterTone(fileCoverage.ratio)">
                  <i :style="{ width: (fileCoverage.ratio === 0 ? 2 : fileCoverage.ratio) + '%' }"></i>
                </span>
                <span v-if="coverage.unanchoredFiles.length" class="muted">
                  {{ coverage.unanchoredFiles.length }}
                  {{ coverage.unanchoredFiles.length === 1 ? 'file' : 'files' }} unanchored &mdash;
                  <button type="button" class="link-button" @click="showUnanchoredFiles()">listed below</button>
                </span>
              </article>
              <article class="tile card">
                <span class="tile-label">Stale anchors</span>
                <span class="tile-value">{{ coverage.staleAnchors.length }}</span>
                <span v-if="coverage.staleAnchors.length" class="warn-line">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M7 1.5 13 12H1Z"></path><path d="M7 5.5v3M7 10.2v.3"></path>
                  </svg>
                  targets no longer exist in the repo
                </span>
                <span v-else class="muted">none &mdash; every anchor resolves</span>
              </article>
            </section>

            <section class="coverage-body">
              <div class="coverage-main">
                <div class="card coverage-tree">
                  <h3>Repository coverage</h3>
                  <coverage-directory v-for="dir in coverage.directories" :key="dir.path" :dir="dir" />
                  <p v-if="!coverage.directories.length" class="muted">No repository files were scanned.</p>
                  <p class="muted footnote">
                    Counts include files matched by pattern and directory anchors. Ignored paths come from
                    <strong>.ydk/ignore</strong>.
                  </p>
                </div>

                <div id="unanchored-files" class="card unanchored-files">
                  <div class="section-head">
                    <h3>Unanchored files</h3>
                    <span v-if="coverage.unanchoredFiles.length" class="badge warn">
                      {{ coverage.unanchoredFiles.length }}
                    </span>
                  </div>
                  <template v-if="unanchoredFileGroups.length">
                    <p class="muted">
                      No anchor reaches these files. Anchor them, or list them in <strong>.ydk/ignore</strong>.
                    </p>
                    <div v-for="group in unanchoredFileGroups" :key="group.directory" class="file-group">
                      <div class="file-group-head">
                        <span class="dir-name">
                          {{ group.directory === '.' ? '(repository root)' : group.directory }}
                        </span>
                        <span class="badge warn">{{ group.files.length }}</span>
                      </div>
                      <div class="file-names">
                        <span v-for="file in group.files" :key="file">{{ file }}</span>
                      </div>
                    </div>
                  </template>
                  <p v-else class="muted">no unanchored files</p>
                </div>
              </div>

              <div class="coverage-side">
                <div class="card">
                  <div class="section-head">
                    <h3>Unanchored purpose nodes</h3>
                    <span v-if="coverage.unanchoredNodes.length" class="badge warn">{{ coverage.unanchoredNodes.length }}</span>
                  </div>
                  <template v-if="coverage.unanchoredNodes.length">
                    <p class="muted">These claim purpose but point at no implementation yet.</p>
                    <button
                      v-for="node in coverage.unanchoredNodes"
                      :key="node.id"
                      type="button"
                      class="list-row"
                      @click="openInExplorer(node.id)"
                    >
                      <span class="node-id">{{ node.id }}</span>
                      <span class="list-title">{{ node.title }}</span>
                    </button>
                  </template>
                  <p v-else class="muted">Every capability and feature has at least one anchor.</p>
                </div>

                <div v-if="assessmentSummary" class="card">
                  <div class="section-head">
                    <h3>Assessed purpose nodes</h3>
                    <span class="badge">{{ assessmentSummary.assessed }}</span>
                    <span class="muted section-note">lowest score first</span>
                  </div>
                  <p class="muted">
                    assessed {{ assessmentSummary.assessed }} / {{ assessmentSummary.total }} anchorable nodes<template
                      v-if="assessmentSummary.average"> &middot; avg score {{ assessmentSummary.average }}</template>
                  </p>
                  <button
                    v-for="node in assessedNodes"
                    :key="node.id"
                    type="button"
                    class="list-row"
                    @click="openInExplorer(node.id)"
                  >
                    <span class="node-id">{{ node.id }}</span>
                    <span class="list-title">{{ node.title }}</span>
                    <span v-if="node.findings" class="muted list-findings">{{ node.findings }}</span>
                    <span class="badge" :class="scoreTone(node.score)">{{ scoreLabel(node.score) }}</span>
                  </button>
                </div>

                <div class="card">
                  <div class="section-head">
                    <h3>Anchors with missing targets</h3>
                    <span v-if="coverage.staleAnchors.length" class="badge danger">{{ coverage.staleAnchors.length }}</span>
                  </div>
                  <template v-if="coverage.staleAnchors.length">
                    <button
                      v-for="stale in coverage.staleAnchors"
                      :key="stale.display + stale.node"
                      type="button"
                      class="list-row stacked"
                      @click="openInExplorer(stale.node)"
                    >
                      <span class="list-line">
                        <strong>{{ stale.display }}</strong>
                        <span class="muted">{{ stale.node }}</span>
                      </span>
                      <span class="stale-note">{{ stale.reason }}</span>
                    </button>
                  </template>
                  <p v-else class="muted">No anchor points at a missing target.</p>
                </div>
              </div>
            </section>
          </div>
        </template>
      </template>
    </main>
  `,
};

const app = createApp(App);
app.component("anchor-card", AnchorCard);
app.component("chevron", Chevron);
app.component("outline-node", OutlineNode);
app.component("coverage-directory", CoverageDirectory);
app.component("map-view", MapView);
app.mount("#app");
