import {
  computed,
  createApp,
  onMounted,
  onUnmounted,
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
const VIEW = "map";
/** Routes that used to be their own page and now resolve to a node on the map. */
const LEGACY_VIEWS = new Set(["explorer", "coverage"]);
const MAX_SCORE = 4;
/** Below this a node's anchored artifacts do not yet fulfill what it claims. */
const SCORE_WARNING_LEVEL = 3;
/** At or below this the anchors barely serve the claim at all. */
const SCORE_DANGER_LEVEL = 1;
/** The filter chip for nodes worth looking at first. */
const SCORE_LOW_LEVEL = 2;
/** Below this many anchors a flat list reads better than directory groups. */
const ANCHOR_GROUP_THRESHOLD = 5;

const NODE_SIZES = {
  mission: { width: 240, height: 96 },
  outcome: { width: 280, height: 88 },
  capability: { width: 300, height: 54 },
  feature: { width: 330, height: 46 },
};
const FALLBACK_SIZE = { width: 280, height: 66 };
const CHILD_NOUNS = {
  outcome: ["outcome", "outcomes"],
  capability: ["capability", "capabilities"],
  feature: ["feature", "features"],
};
const COLUMN_GAP = 70;
const ROW_GAP = 12;
const STAGE_TOP = 26;
const STAGE_PAD = 16;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
const MAX_FIT_SCALE = 1.6;

const FILTER_MODES = [
  { key: "all", label: "All nodes" },
  { key: "low", label: "Score ≤ " + SCORE_LOW_LEVEL },
  { key: "unassessed", label: "Unassessed" },
  { key: "unanchored", label: "Unanchored" },
];

/* ---------------------------------------------------------------- helpers */

function percent(part, total) {
  if (!total) return 0;
  return Math.round((100 * part) / total);
}

function scoreLabel(score) {
  return "score " + score + "/" + MAX_SCORE;
}

/** Compact form for places too narrow for the word, such as a map chip. */
function scoreBadge(score) {
  return (score === null || score === undefined ? "–" : score) + "/" + MAX_SCORE;
}

/**
 * The band a score falls in. Rolled-up averages land here too, so a subtree
 * averaging 2.5 reads as partly fulfilled rather than rounding into either end.
 */
function scoreBand(score) {
  if (score === null || score === undefined) return "none";
  if (score <= SCORE_DANGER_LEVEL) return "danger";
  return score < SCORE_WARNING_LEVEL ? "warn" : "good";
}

function scoreTone(score) {
  const band = scoreBand(score);
  return { danger: band === "danger", unassessed: band === "none", warn: band === "warn" };
}

function anchorCountLabel(count) {
  if (count === 0) return "no anchors";
  return count + (count === 1 ? " anchor" : " anchors");
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

/**
 * Per-node rollups behind the map subtitles and chip badges. A mission or
 * outcome carries no score of its own, so it reports the average of every
 * assessed node beneath it, and says how much of that subtree is still unjudged.
 */
function buildSubtreeStats(nodes, edges) {
  const byId = indexNodes(nodes);
  const children = childrenByParent(nodes, edges);
  const stats = new Map();

  for (const node of nodes) {
    const descendants = collectDescendants(node.id, children);
    let anchorTotal = node.anchors?.length ?? 0;
    let assessableCount = 0;
    let assessedCount = 0;
    let scoreTotal = 0;
    for (const id of descendants) {
      const descendant = byId.get(id);
      if (!descendant) continue;
      anchorTotal += descendant.anchors?.length ?? 0;
      if (!ANCHORABLE_TYPES.has(descendant.type)) continue;
      assessableCount += 1;
      if (descendant.assessment) {
        assessedCount += 1;
        scoreTotal += descendant.assessment.score;
      }
    }
    stats.set(node.id, {
      anchorTotal,
      assessableCount,
      assessedCount,
      averageScore: assessedCount ? scoreTotal / assessedCount : null,
      childCount: (children.get(node.id) ?? []).length,
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

/**
 * One page, one route. A node id is the only thing the hash carries; the pages
 * that used to have their own route now answer through the node opened below
 * the map, so their links still land somewhere true.
 */
function parseHash(raw, hasNode) {
  const cleaned = String(raw ?? "").replace(/^#\/?/u, "");
  const [viewPart, idPart] = cleaned.split("/");
  const routed = viewPart === VIEW || LEGACY_VIEWS.has(viewPart);
  const id = routed && idPart ? decodeURIComponent(idPart) : null;
  return { id: id && (!hasNode || hasNode(id)) ? id : null };
}

function formatHash(id) {
  return id ? "#/" + VIEW + "/" + encodeURIComponent(id) : "#/" + VIEW;
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
  props: { anchor: { type: Object, required: true } },
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
          :title="anchor.stale ? (anchor.staleReason || 'anchor target is missing') : ''"
        >{{ meta }}</span>
      </div>
      <p class="anchor-reason" :title="anchor.reason">{{ anchor.reason }}</p>
    </article>
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
    const mode = ref("all");
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

    const filtering = computed(() => mode.value !== "all" || filter.value.trim() !== "");

    /**
     * The chips filter by dimming rather than by hiding, so a node that fails
     * the filter still holds its place and the shape of the graph is unchanged.
     */
    function matchesFilter(node) {
      const query = filter.value.trim().toLowerCase();
      if (query && !(node.id + " " + node.title).toLowerCase().includes(query)) return false;

      const info = props.meta.get(node.id);
      if (mode.value === "all" || !info) return true;
      if (mode.value === "low") return info.score !== null && info.score <= SCORE_LOW_LEVEL;
      if (mode.value === "unassessed") return info.score === null;
      if (mode.value === "unanchored") return info.unanchored;
      return true;
    }

    function nodeClass(node) {
      const highlight = props.highlight;
      const id = node.id;
      const offPath = highlight.active && !highlight.pathNodes.has(id) && !highlight.subtree.has(id);
      const info = props.meta.get(id);
      return {
        ["band-" + (info?.band ?? "none")]: true,
        selected: id === props.selectedId,
        "on-path": highlight.active && id !== props.selectedId && highlight.pathNodes.has(id),
        // A filter is an explicit request, so what it matches stays lit even off
        // the selected node's path; without one, the path decides on its own.
        dimmed: !matchesFilter(node) || (!filtering.value && offPath),
      };
    }

    function nodeLabel(box) {
      const info = props.meta.get(box.node.id);
      const parts = [box.node.type, box.node.id, box.node.title];
      if (info?.anchorable) {
        parts.push(anchorCountLabel(info.anchorCount));
        parts.push(info.score === null ? "not assessed" : "score " + info.score + " of " + MAX_SCORE);
      } else if (info) {
        parts.push(
          info.score === null
            ? "nothing beneath it assessed"
            : "average score " + info.score.toFixed(1) + " of " + MAX_SCORE,
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
      // Escape is handled for the whole page, so it closes the detail from inside it too.
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
      filterModes: FILTER_MODES,
      fit,
      mode,
      nodeClass,
      nodeLabel,
      onNodeKey,
      scale,
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
            placeholder="Find a node or file path"
            aria-label="Filter map nodes by id or title"
            @keydown.esc.prevent="filter = ''"
          >
        </div>
        <div class="map-modes" role="group" aria-label="Filter nodes">
          <button
            v-for="option in filterModes"
            :key="option.key"
            type="button"
            class="chip mode-chip"
            :class="{ active: mode === option.key }"
            :aria-pressed="mode === option.key ? 'true' : 'false'"
            @click="mode = option.key"
          >{{ option.label }}</button>
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

      <div class="map-legend">
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
        <span class="legend-rule"></span>
        <span class="legend-scores">
          Fulfillment
          <span class="legend-score"><i class="band-swatch band-good"></i><span class="badge">3&ndash;4</span></span> fulfils
          <span class="legend-score"><i class="band-swatch band-warn"></i><span class="badge warn">2</span></span> partial
          <span class="legend-score"><i class="band-swatch band-danger"></i><span class="badge danger">0&ndash;1</span></span> does not serve
          <span class="legend-score"><i class="band-swatch band-none"></i><span class="badge unassessed">&ndash;/4</span></span> not assessed
        </span>
        <span class="legend-rule"></span>
        <span class="map-hint">
          <kbd>&#8592;</kbd><kbd>&#8593;</kbd><kbd>&#8594;</kbd><kbd>&#8595;</kbd> move
          <kbd>Enter</kbd> open below
          <kbd>Esc</kbd> close
        </span>
      </div>

      <div
        ref="stage"
        class="map-stage"
        :style="{ maxHeight: (layout.height * scale + 24) + 'px' }"
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
              <span class="map-node-head">
                <span class="map-node-id">{{ box.node.id }}</span>
                <span
                  v-if="meta.get(box.node.id).anchorable"
                  class="map-node-anchors"
                  :class="{ warn: meta.get(box.node.id).anchorCount === 0 }"
                >{{ meta.get(box.node.id).countText }}</span>
                <span class="badge map-node-score" :class="scoreTone(meta.get(box.node.id).score)">
                  {{ meta.get(box.node.id).badgeText }}
                </span>
              </span>
              <span class="map-node-title">{{ box.node.title }}</span>
              <span
                v-if="meta.get(box.node.id).summary"
                class="map-node-meta"
                :class="{ warn: meta.get(box.node.id).summaryWarn }"
              >{{ meta.get(box.node.id).summary }}</span>
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

    const selectedId = ref(null);
    const explicitSelection = ref(false);

    const openAnchorGroups = ref({});

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
          assessedNodeCount: 0,
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
    const averageScoreText = computed(() =>
      stats.value.averageScore === null || stats.value.averageScore === undefined
        ? null
        : stats.value.averageScore.toFixed(1),
    );

    const selectedNode = computed(() => nodeById.value.get(selectedId.value) ?? null);

    /* ------------------------------------------------------------ routing */

    function applyHash() {
      const parsed = parseHash(window.location.hash, (id) => nodeById.value.has(id));
      if (parsed.id) {
        selectedId.value = parsed.id;
        explicitSelection.value = true;
      } else {
        selectedId.value = missionId.value;
        explicitSelection.value = false;
      }
      // A retired route rewrites itself even when the node it named is unchanged.
      syncHash();
    }

    function syncHash() {
      const next = formatHash(explicitSelection.value ? selectedId.value : null);
      if (window.location.hash !== next) window.location.hash = next;
    }

    function selectNode(id) {
      if (!nodeById.value.has(id)) return;
      selectedId.value = id;
      explicitSelection.value = true;
    }

    watch([selectedId, explicitSelection], syncHash);

    /* ------------------------------------------------------ node detail */

    const selectedTraces = computed(() => {
      const node = selectedNode.value;
      if (!node) return [];
      const traces = node.traces?.length ? node.traces : node.trace?.length ? [node.trace] : [];
      return traces.map((trace) => trace.map((id) => nodeById.value.get(id)).filter(Boolean));
    });

    /** The detail section is the selection made explicit, so closing it clears the focus. */
    const detailNode = computed(() => (explicitSelection.value ? selectedNode.value : null));

    const selectedAssessment = computed(() => detailNode.value?.assessment ?? null);

    /** A mission or outcome carries no judgment of its own; it reports its subtree's. */
    const selectedRollup = computed(() => {
      const node = detailNode.value;
      if (!node || node.assessment || ANCHORABLE_TYPES.has(node.type)) return null;
      const stat = subtreeStats.value.get(node.id);
      if (!stat?.assessableCount) return null;
      return {
        assessed: stat.assessedCount,
        average: stat.averageScore,
        total: stat.assessableCount,
      };
    });

    const anchorGroups = computed(() => groupAnchorsByDirectory(detailNode.value?.anchors ?? []));

    // Few enough anchors and the directory headings cost more than they explain.
    const anchorsGrouped = computed(
      () => (detailNode.value?.anchors ?? []).length > ANCHOR_GROUP_THRESHOLD,
    );

    const staleAnchorCount = computed(
      () => (detailNode.value?.anchors ?? []).filter((anchor) => anchor.stale).length,
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
     * What each map chip shows beyond its title: the node's own score and anchor
     * count for the tiers that can be anchored and assessed, and the average of
     * everything beneath for the tiers that only aggregate.
     */
    const mapNodeMeta = computed(() => {
      const meta = new Map();
      for (const node of nodes.value) {
        const stat = subtreeStats.value.get(node.id);
        const anchorCount = node.anchors?.length ?? 0;
        const anchorable = ANCHORABLE_TYPES.has(node.type);
        const score = anchorable ? (node.assessment ? node.assessment.score : null) : stat?.averageScore ?? null;

        let summary = null;
        let summaryWarn = false;
        // The mission's rollup badge already speaks for the whole graph, so only
        // the tiers between it and the anchored work count what sits beneath them.
        if (!anchorable && node.type !== "mission" && stat?.childCount) {
          const childNode = nodeById.value.get((children.value.get(node.id) ?? [])[0]);
          const nouns = CHILD_NOUNS[childNode?.type] ?? ["child", "children"];
          summary = stat.childCount + " " + (stat.childCount === 1 ? nouns[0] : nouns[1]);
          const unassessed = stat.assessableCount - stat.assessedCount;
          if (stat.assessableCount && stat.assessedCount === 0) {
            summary += " · none assessed";
            summaryWarn = true;
          } else if (unassessed > 0) {
            summary += " · " + unassessed + " unassessed";
            summaryWarn = true;
          }
        }

        meta.set(node.id, {
          anchorable,
          anchorCount,
          badgeText: anchorable || score === null ? scoreBadge(score) : "avg " + score.toFixed(1),
          band: scoreBand(score),
          // A feature chip is one narrow row, so the word only survives where it fits.
          countText:
            anchorCount === 0 || node.type !== "feature" ? anchorCountLabel(anchorCount) : String(anchorCount),
          score,
          summary,
          summaryWarn,
          unanchored: anchorable ? anchorCount === 0 : (stat?.anchorTotal ?? 0) === 0,
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

    /** Closing the detail section and dropping the map highlight are one act. */
    function clearFocus() {
      explicitSelection.value = false;
    }

    // Escape closes the detail section from anywhere on the page, except while
    // typing, where the field it belongs to has first claim on the key.
    function onEscape(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      clearFocus();
    }

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
      averageScoreText,
      clearFocus,
      detailNode,
      error,
      groupLabel,
      isGroupOpen,
      loading,
      mapHighlight,
      mapLayout,
      mapNodeMeta,
      nodes,
      project,
      scoreLabel,
      scoreTone,
      selectNode,
      selectedAssessment,
      selectedId,
      selectedRollup,
      staleAnchorCount,
      stats,
      toggleGroup,
      validation,
    };
  },
  template: `
    <main class="shell">
      <header class="topbar">
        <div class="topbar-title">
          <h1>Project Purpose Map</h1>
          <p class="eyebrow">ydk</p>
        </div>
        <div v-if="project" class="stats" aria-label="project stats">
          <span><strong>{{ stats.nodeCount }}</strong> nodes</span>
          <span><strong>{{ stats.anchorCount }}</strong> anchors</span>
          <span v-if="stats.anchorableNodeCount"><strong>{{ anchoredPercent }}%</strong> anchored</span>
          <span v-if="stats.anchorableNodeCount" class="stat-ratio"><strong>{{ stats.assessedNodeCount }}</strong>/{{ stats.anchorableNodeCount }} assessed</span>
          <span v-if="averageScoreText" class="stat-ratio" :class="scoreTone(stats.averageScore)">avg score <strong>{{ averageScoreText }}</strong>/4</span>
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
          <map-view
            :layout="mapLayout"
            :highlight="mapHighlight"
            :selected-id="selectedId"
            :meta="mapNodeMeta"
            @select="selectNode"
            @clear="clearFocus"
          />

          <!-- The selected node, read at length under the map it was picked from. -->
          <section v-if="detailNode" class="card detail" aria-label="selected node">
            <div class="detail-head">
              <div class="detail-heading">
                <p class="eyebrow">{{ detailNode.type }}</p>
                <h2>{{ detailNode.title }}</h2>
              </div>
              <span
                v-if="selectedAssessment"
                class="badge"
                :class="scoreTone(selectedAssessment.score)"
              >{{ scoreLabel(selectedAssessment.score) }}</span>
              <span
                v-else-if="selectedRollup"
                class="badge"
                :class="scoreTone(selectedRollup.average)"
              >avg {{ selectedRollup.average.toFixed(1) }}/4</span>
              <span class="node-pill">{{ detailNode.id }}</span>
              <span class="detail-assessed muted">
                <template v-if="selectedAssessment">assessed {{ selectedAssessment.assessed }}</template>
                <template v-else-if="selectedRollup">
                  {{ selectedRollup.assessed }}/{{ selectedRollup.total }} nodes beneath assessed
                </template>
                <template v-else>not assessed</template>
              </span>
              <button type="button" class="panel-close" aria-label="Close node detail" @click="clearFocus()">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" aria-hidden="true"><path d="M2 2 8 8 M8 2 2 8"></path></svg>
              </button>
            </div>

            <div class="detail-body">
              <div class="detail-half">
                <p v-if="detailNode.statement" class="statement">{{ detailNode.statement }}</p>

                <div class="section-head">
                  <h3>Anchored artifacts</h3>
                  <span class="badge">{{ detailNode.anchors.length }}</span>
                  <span v-if="detailNode.anchors.length" class="muted section-note">
                    <template v-if="anchorsGrouped">
                      {{ anchorGroups.length }} {{ anchorGroups.length === 1 ? 'directory' : 'directories' }}
                    </template><template v-if="anchorsGrouped && staleAnchorCount"> &middot; </template><template
                      v-if="staleAnchorCount">{{ staleAnchorCount }} stale</template>
                  </span>
                </div>

                <div v-if="anchorsGrouped" class="anchor-columns">
                  <div v-for="group in anchorGroups" :key="group.directory" class="artifact-group">
                    <button
                      type="button"
                      class="group-header"
                      :aria-expanded="isGroupOpen(group.directory) ? 'true' : 'false'"
                      @click="toggleGroup(group.directory)"
                    >
                      <chevron :open="isGroupOpen(group.directory)" />
                      <span class="group-name">{{ groupLabel(group.directory) }}</span>
                      <span v-if="group.staleCount" class="badge danger">{{ group.staleCount }} stale</span>
                      <span v-else class="badge">{{ group.anchors.length }}</span>
                    </button>
                    <div v-if="isGroupOpen(group.directory)" class="group-body">
                      <anchor-card v-for="anchor in group.anchors" :key="anchor.display" :anchor="anchor" />
                    </div>
                  </div>
                </div>

                <div v-else-if="detailNode.anchors.length" class="anchor-columns">
                  <anchor-card v-for="anchor in detailNode.anchors" :key="anchor.display" :anchor="anchor" />
                </div>

                <p v-else class="muted">No artifacts anchor directly to this node.</p>
              </div>

              <div class="detail-half findings">
                <template v-if="selectedAssessment">
                  <div class="finding-column">
                    <div class="section-head">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#7d5b2e" stroke-width="1.6"
                        stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5.2" stroke-dasharray="3 2.6"></circle></svg>
                      <h3>Claimed but not delivered</h3>
                      <span class="badge warn">{{ selectedAssessment.unfulfilled.length }}</span>
                    </div>
                    <p v-for="finding in selectedAssessment.unfulfilled" :key="finding" class="finding unfulfilled">
                      {{ finding }}
                    </p>
                    <p v-if="!selectedAssessment.unfulfilled.length" class="muted">
                      Everything this node claims is delivered by what it anchors.
                    </p>
                  </div>

                  <div class="finding-column">
                    <div class="section-head">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#314a3d" stroke-width="1.6"
                        stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5.2"></circle><path d="M7 4.6v4.8M4.6 7h4.8"></path></svg>
                      <h3>Delivered but not claimed</h3>
                      <span class="badge">{{ selectedAssessment.undeclared.length }}</span>
                    </div>
                    <p v-for="finding in selectedAssessment.undeclared" :key="finding" class="finding undeclared">
                      {{ finding }}
                    </p>
                    <p v-if="!selectedAssessment.undeclared.length" class="muted">
                      Nothing anchored here does work this node does not claim.
                    </p>
                  </div>
                </template>

                <div v-else class="finding-column">
                  <div class="section-head">
                    <h3>Assessment</h3>
                  </div>
                  <p v-if="selectedRollup" class="muted">
                    This node carries no judgment of its own. The
                    {{ selectedRollup.assessed }} assessed of {{ selectedRollup.total }} anchorable nodes beneath it
                    average {{ selectedRollup.average.toFixed(1) }}/4.
                  </p>
                  <p v-else class="muted">
                    No assessment recorded. Add an entry to <strong>.ydk/assessments.yaml</strong> to judge how well
                    the anchored artifacts fulfill this node.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </template>
      </template>
    </main>
  `,
};

const app = createApp(App);
app.component("anchor-card", AnchorCard);
app.component("chevron", Chevron);
app.component("map-view", MapView);
app.mount("#app");
