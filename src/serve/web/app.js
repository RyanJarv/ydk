import {
  computed,
  createApp,
  inject,
  nextTick,
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
const VIEWS = ["map", "coverage"];
const DEFAULT_VIEW = "map";
/** The Explorer page moved to the CLI (`ydk why`); its links still point somewhere. */
const LEGACY_VIEW = "explorer";
const MAX_SCORE = 4;
/** Below this a node's anchored artifacts do not yet fulfill what it claims. */
const SCORE_WARNING_LEVEL = 3;
/** At or below this the anchors barely serve the claim at all. */
const SCORE_DANGER_LEVEL = 1;
/** Below this many anchors a flat list reads better than directory groups. */
const ANCHOR_GROUP_THRESHOLD = 5;

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

/** Per-node rollups behind the map subtitles and chip counts. */
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

function anchorDirectory(display) {
  const withoutFragment = String(display ?? "").split("#")[0];
  const index = withoutFragment.lastIndexOf("/");
  return index === -1 ? "." : withoutFragment.slice(0, index + 1);
}

function groupAnchorsByDirectory(anchors) {
  const groups = new Map();
  for (const anchor of anchors ?? []) {
    const directory = anchor.kind === "url" ? SURFACE_GROUP : anchorDirectory(anchor.display);
    const group = groups.get(directory) ?? { directory, anchors: [], staleCount: 0 };
    group.anchors.push(anchor);
    if (anchor.stale) group.staleCount += 1;
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
  // An old #/explorer link asked to read one node; the map panel now answers that.
  const requested = viewPart === LEGACY_VIEW ? "map" : viewPart;
  const view = VIEWS.includes(requested) ? requested : DEFAULT_VIEW;
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

/**
 * One anchored artifact as two lines: what it is, then why it is claimed. The
 * reason is clipped to a single line so a long list of anchors stays scannable;
 * the full text stays reachable through the title.
 */
const AnchorCard = {
  name: "AnchorCard",
  props: {
    anchor: { type: Object, required: true },
    staleReason: { type: String, default: "" },
  },
  computed: {
    meta() {
      const parts = [];
      if (this.anchor.matchCount !== undefined) parts.push("matches " + this.anchor.matchCount + " files");
      if (this.anchor.stale) parts.push("stale");
      return parts.join(" · ");
    },
  },
  template: `
    <article class="anchor-row">
      <div class="anchor-line">
        <span class="kind">{{ anchor.kind }}</span>
        <a v-if="anchor.kind === 'url'" class="anchor-path" :href="anchor.display">{{ anchor.display }}</a>
        <span v-else class="anchor-path" :title="anchor.display">{{ anchor.display }}</span>
        <span
          v-if="meta"
          class="anchor-meta"
          :class="{ stale: anchor.stale }"
          :title="anchor.stale ? staleReason : ''"
        >{{ meta }}</span>
      </div>
      <p class="anchor-reason" :title="anchor.reason">{{ anchor.reason }}</p>
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
      }
      // Escape is handled for the whole page, so it closes the panel from inside it too.
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
        &middot; <kbd>Enter</kbd> open the detail panel &middot; <kbd>Esc</kbd> close it
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

    const openAnchorGroups = ref({});
    const openDirectories = ref({});
    const openAssessed = ref({});

    const nodes = computed(() => project.value?.nodes ?? []);
    const edges = computed(() => project.value?.edges ?? []);
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

    /** Coverage names a node; the map is where that node can be seen in context. */
    function showOnMap(id) {
      view.value = "map";
      selectNode(id);
    }

    function setView(next) {
      view.value = next;
    }

    watch([view, selectedId, explicitSelection], syncHash);

    /* -------------------------------------------------------- node panel */

    const selectedTraces = computed(() => {
      const node = selectedNode.value;
      if (!node) return [];
      const traces = node.traces?.length ? node.traces : node.trace?.length ? [node.trace] : [];
      return traces.map((trace) => trace.map((id) => nodeById.value.get(id)).filter(Boolean));
    });

    /** The panel is the selection made explicit, so closing it clears the focus. */
    const panelNode = computed(() => (explicitSelection.value ? selectedNode.value : null));

    const selectedAssessment = computed(() => panelNode.value?.assessment ?? null);

    /** What the panel says about drift, in the words the Coverage page uses. */
    const selectedDrift = computed(() => {
      const assessment = selectedAssessment.value;
      if (!assessment) return null;
      const parts = [];
      if (assessment.unfulfilled.length) parts.push(assessment.unfulfilled.length + " unfulfilled");
      if (assessment.undeclared.length) parts.push(assessment.undeclared.length + " undeclared");
      return parts.length ? parts.join(" · ") : null;
    });

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

    /** Closing the panel and dropping the map highlight are one act. */
    function clearFocus() {
      explicitSelection.value = false;
    }

    // Escape closes the panel from anywhere on the page, except while typing,
    // where the field it belongs to has first claim on the key.
    function onEscape(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      clearFocus();
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
          const unfulfilled = assessment?.unfulfilled ?? [];
          const undeclared = assessment?.undeclared ?? [];
          const findings = [];
          if (unfulfilled.length) findings.push(unfulfilled.length + " unfulfilled");
          if (undeclared.length) findings.push(undeclared.length + " undeclared");
          return { ...node, undeclared, unfulfilled, findings: findings.join(" · ") };
        })
        .sort((left, right) => left.score - right.score),
    );

    function isAssessedOpen(id) {
      return openAssessed.value[id] === true;
    }

    function toggleAssessed(id) {
      openAssessed.value = { ...openAssessed.value, [id]: !isAssessedOpen(id) };
    }

    /**
     * The panel names how much a node has drifted; Coverage holds the findings
     * themselves. Following the line opens the row that spells them out.
     */
    async function showDriftInCoverage(id) {
      view.value = "coverage";
      openAssessed.value = { ...openAssessed.value, [id]: true };
      await nextTick();
      document.getElementById("assessed-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

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
      window.addEventListener("keydown", onEscape);
    });

    onUnmounted(() => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener("keydown", onEscape);
    });

    return {
      anchorGroups,
      anchoredPercent,
      anchorsGrouped,
      assessedNodes,
      assessmentSummary,
      clearFocus,
      coverage,
      error,
      fileCoverage,
      groupLabel,
      isAssessedOpen,
      isGroupOpen,
      loading,
      mapHighlight,
      mapLayout,
      mapNodeMeta,
      meterTone,
      nodeCoverage,
      nodes,
      panelNode,
      project,
      scoreLabel,
      scoreTone,
      selectNode,
      selectedAssessment,
      selectedDrift,
      selectedId,
      setView,
      showDriftInCoverage,
      showOnMap,
      showUnanchoredFiles,
      staleReason,
      stats,
      toggleAssessed,
      toggleGroup,
      unanchoredFileGroups,
      validation,
      view,
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

            <!-- Node detail: the selection, read at length beside the map. -->
            <aside v-if="panelNode" class="node-panel card" aria-label="selected node">
              <div class="panel-header">
                <div class="panel-heading">
                  <p class="eyebrow">{{ panelNode.type }}</p>
                  <h2>{{ panelNode.title }}</h2>
                </div>
                <button type="button" class="panel-close" aria-label="Close node detail" @click="clearFocus()">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" aria-hidden="true"><path d="M2 2 8 8 M8 2 2 8"></path></svg>
                </button>
              </div>

              <div class="panel-badges">
                <span
                  v-if="selectedAssessment"
                  class="badge"
                  :class="scoreTone(selectedAssessment.score)"
                  :title="'Assessed ' + selectedAssessment.assessed"
                >{{ scoreLabel(selectedAssessment.score) }}</span>
                <span class="node-pill">{{ panelNode.id }}</span>
              </div>

              <p v-if="panelNode.statement" class="statement">{{ panelNode.statement }}</p>

              <section class="artifacts">
                <div class="section-head">
                  <h3>Anchored artifacts</h3>
                  <span v-if="panelNode.anchors.length" class="muted section-note">
                    <template v-if="anchorsGrouped">
                      {{ panelNode.anchors.length }} across {{ anchorGroups.length }} {{ anchorGroups.length === 1 ? 'directory' : 'directories' }}
                    </template><template v-else>
                      {{ panelNode.anchors.length === 1 ? '1 anchor' : panelNode.anchors.length + ' anchors' }}
                    </template>
                  </span>
                </div>

                <template v-if="anchorsGrouped">
                  <div v-for="group in anchorGroups" :key="group.directory" class="artifact-group">
                    <button
                      type="button"
                      class="group-header"
                      :aria-expanded="isGroupOpen(group.directory) ? 'true' : 'false'"
                      @click="toggleGroup(group.directory)"
                    >
                      <chevron :open="isGroupOpen(group.directory)" />
                      <span class="group-name">{{ groupLabel(group.directory) }}</span>
                      <span class="badge">{{ group.anchors.length }}</span>
                      <span v-if="group.staleCount" class="badge danger">{{ group.staleCount }} stale</span>
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

                <div v-else-if="panelNode.anchors.length" class="group-body flat">
                  <anchor-card
                    v-for="anchor in panelNode.anchors"
                    :key="anchor.display"
                    :anchor="anchor"
                    :stale-reason="anchor.stale ? staleReason(anchor) : ''"
                  />
                </div>

                <p v-else class="muted">No artifacts anchor directly to this node.</p>
              </section>

              <p v-if="selectedDrift" class="panel-drift">
                <button type="button" class="link-button" @click="showDriftInCoverage(panelNode.id)">
                  {{ selectedDrift }} &mdash; details in Coverage
                </button>
              </p>
            </aside>
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
                      :title="'Show ' + node.id + ' on the Map'"
                      @click="showOnMap(node.id)"
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
                    &middot; expand a row for its findings
                  </p>
                  <div
                    v-for="node in assessedNodes"
                    :key="node.id"
                    :id="'assessed-' + node.id"
                    class="assessed-row"
                    :class="{ open: isAssessedOpen(node.id) }"
                  >
                    <div class="assessed-head">
                      <button
                        type="button"
                        class="assessed-toggle"
                        :aria-expanded="isAssessedOpen(node.id) ? 'true' : 'false'"
                        :aria-label="(isAssessedOpen(node.id) ? 'Hide ' : 'Show ') + node.id + ' findings'"
                        @click="toggleAssessed(node.id)"
                      >
                        <chevron :open="isAssessedOpen(node.id)" />
                      </button>
                      <button
                        type="button"
                        class="assessed-id node-id"
                        :title="'Show ' + node.id + ' on the Map'"
                        @click="showOnMap(node.id)"
                      >{{ node.id }}</button>
                      <button
                        type="button"
                        class="assessed-body"
                        :aria-expanded="isAssessedOpen(node.id) ? 'true' : 'false'"
                        @click="toggleAssessed(node.id)"
                      >
                        <span class="list-title">{{ node.title }}</span>
                        <span v-if="node.findings" class="muted list-findings">{{ node.findings }}</span>
                        <span class="badge" :class="scoreTone(node.score)">{{ scoreLabel(node.score) }}</span>
                      </button>
                    </div>

                    <div v-if="isAssessedOpen(node.id)" class="assessed-detail">
                      <div v-if="node.unfulfilled.length">
                        <h4>Claimed but not delivered</h4>
                        <ul class="finding-list">
                          <li v-for="finding in node.unfulfilled" :key="finding">{{ finding }}</li>
                        </ul>
                      </div>
                      <div v-if="node.undeclared.length">
                        <h4>Delivered but not claimed</h4>
                        <ul class="finding-list">
                          <li v-for="finding in node.undeclared" :key="finding">{{ finding }}</li>
                        </ul>
                      </div>
                      <p v-if="!node.unfulfilled.length && !node.undeclared.length" class="muted">
                        No findings recorded for this node.
                      </p>
                      <p class="muted">assessed {{ node.assessed }}</p>
                    </div>
                  </div>
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
                      :title="'Show ' + stale.node + ' on the Map'"
                      @click="showOnMap(stale.node)"
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
app.component("coverage-directory", CoverageDirectory);
app.component("map-view", MapView);
app.mount("#app");
