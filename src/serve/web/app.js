import { computed, createApp, onMounted, ref } from "/vendor/vue.esm-browser.prod.js";

const typeOrder = ["mission", "outcome", "capability", "feature"];
const typeLabels = {
  mission: "Mission",
  outcome: "Outcome",
  capability: "Capability",
  feature: "Features",
};

createApp({
  setup() {
    const project = ref(null);
    const validation = ref(null);
    const selectedId = ref(null);
    const search = ref("");
    const loading = ref(true);
    const error = ref("");

    onMounted(async () => {
      try {
        const response = await fetch("/api/project");
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = await response.json();
        project.value = payload.project;
        validation.value = payload.validation;
        selectedId.value = payload.project.nodes.find((node) => node.type === "mission")?.id ?? payload.project.nodes[0]?.id ?? null;
      } catch (caught) {
        error.value = caught instanceof Error ? caught.message : String(caught);
      } finally {
        loading.value = false;
      }
    });

    const nodes = computed(() => project.value?.nodes ?? []);
    const edges = computed(() => project.value?.edges ?? []);
    const anchors = computed(() => project.value?.anchors ?? []);

    const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedId.value) ?? null);
    const selectedTrace = computed(() => selectedNode.value?.trace.map((id) => nodeById.value.get(id)).filter(Boolean) ?? []);

    const nodeById = computed(() => new Map(nodes.value.map((node) => [node.id, node])));

    const childIdsByParent = computed(() => {
      const children = new Map();
      for (const edge of edges.value) {
        const list = children.get(edge.to) ?? [];
        list.push(edge.from);
        children.set(edge.to, list);
      }
      return children;
    });

    const groupedNodes = computed(() => {
      const query = search.value.trim().toLowerCase();
      const matchesQuery = (node) => {
        if (!query) return true;
        const anchorText = node.anchors.map((anchor) => `${anchor.display} ${anchor.reason}`).join(" ");
        return `${node.id} ${node.type} ${node.title} ${node.statement ?? ""} ${anchorText}`.toLowerCase().includes(query);
      };

      return typeOrder.map((type) => ({
        type,
        label: typeLabels[type],
        nodes: nodes.value.filter((node) => node.type === type && matchesQuery(node)),
      }));
    });

    const selectedChildren = computed(() => {
      if (!selectedId.value) return [];
      return (childIdsByParent.value.get(selectedId.value) ?? [])
        .map((id) => nodeById.value.get(id))
        .filter(Boolean);
    });

    const selectedParents = computed(() => {
      if (!selectedId.value) return [];
      return edges.value
        .filter((edge) => edge.from === selectedId.value)
        .map((edge) => nodeById.value.get(edge.to))
        .filter(Boolean);
    });

    const visibleAnchors = computed(() => {
      const query = search.value.trim().toLowerCase();
      if (!query) return anchors.value;
      return anchors.value.filter((anchor) => `${anchor.display} ${anchor.kind} ${anchor.reason} ${anchor.nodeTitle}`.toLowerCase().includes(query));
    });

    function selectNode(id) {
      selectedId.value = id;
    }

    return {
      anchors,
      error,
      groupedNodes,
      loading,
      project,
      search,
      selectedChildren,
      selectedId,
      selectedNode,
      selectedParents,
      selectedTrace,
      selectNode,
      validation,
      visibleAnchors,
    };
  },
  template: `
    <main class="shell">
      <section class="topbar">
        <div>
          <p class="eyebrow">ydk project explorer</p>
          <h1>Project Purpose Map</h1>
        </div>
        <div v-if="project" class="stats" aria-label="project stats">
          <span><strong>{{ project.stats.nodeCount }}</strong> nodes</span>
          <span><strong>{{ project.stats.anchorCount }}</strong> anchors</span>
          <span><strong>{{ project.stats.edgeCount }}</strong> edges</span>
        </div>
      </section>

      <p v-if="loading" class="message">Loading project graph...</p>
      <p v-else-if="error" class="message error">{{ error }}</p>

      <template v-else>
        <section v-if="validation && !validation.ok" class="validation">
          <strong>Validation issues</strong>
          <ul>
            <li v-for="issue in validation.errors" :key="issue">{{ issue }}</li>
          </ul>
        </section>

        <section class="workspace">
          <aside class="navigator" aria-label="purpose graph">
            <div class="search">
              <input v-model="search" type="search" placeholder="Search nodes and artifacts" aria-label="Search nodes and artifacts">
            </div>

            <div class="layers">
              <section v-for="group in groupedNodes" :key="group.type" class="layer">
                <div class="layer-title">{{ group.label }}</div>
                <button
                  v-for="node in group.nodes"
                  :key="node.id"
                  class="node-button"
                  :class="{ selected: node.id === selectedId }"
                  type="button"
                  @click="selectNode(node.id)"
                >
                  <span class="node-id">{{ node.id }}</span>
                  <span class="node-title">{{ node.title }}</span>
                  <span v-if="node.anchors.length" class="anchor-count">{{ node.anchors.length }} anchors</span>
                </button>
              </section>
            </div>
          </aside>

          <section class="detail" v-if="selectedNode">
            <div class="detail-header">
              <div>
                <p class="eyebrow">{{ selectedNode.type }}</p>
                <h2>{{ selectedNode.title }}</h2>
              </div>
              <span class="node-pill">{{ selectedNode.id }}</span>
            </div>

            <p v-if="selectedNode.statement" class="statement">{{ selectedNode.statement }}</p>

            <section class="trace">
              <h3>Why Path</h3>
              <ol>
                <li v-for="node in selectedTrace" :key="node.id" :class="{ active: node.id === selectedNode.id }">
                  <button type="button" @click="selectNode(node.id)">
                    <span>{{ node.id }}</span>
                    {{ node.title }}
                  </button>
                </li>
              </ol>
            </section>

            <section class="relationships">
              <div>
                <h3>Supported By</h3>
                <button v-for="node in selectedChildren" :key="node.id" type="button" @click="selectNode(node.id)">
                  {{ node.id }} {{ node.title }}
                </button>
                <p v-if="!selectedChildren.length">No child nodes.</p>
              </div>
              <div>
                <h3>Supports</h3>
                <button v-for="node in selectedParents" :key="node.id" type="button" @click="selectNode(node.id)">
                  {{ node.id }} {{ node.title }}
                </button>
                <p v-if="!selectedParents.length">This is the top-level mission.</p>
              </div>
            </section>

            <section>
              <h3>Anchored Artifacts</h3>
              <div class="artifact-list">
                <article v-for="anchor in selectedNode.anchors" :key="anchor.display" class="artifact">
                  <div>
                    <span class="kind">{{ anchor.kind }}</span>
                    <strong>{{ anchor.display }}</strong>
                  </div>
                  <p>{{ anchor.reason }}</p>
                </article>
                <p v-if="!selectedNode.anchors.length">No artifacts anchor directly to this node.</p>
              </div>
            </section>
          </section>
        </section>

        <section class="artifact-index">
          <h2>Artifact Index</h2>
          <div class="artifact-grid">
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
          </div>
        </section>
      </template>
    </main>
  `,
}).mount("#app");
