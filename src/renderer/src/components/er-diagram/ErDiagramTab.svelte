<script lang="ts">
  import { onMount } from 'svelte'
  import dagre from '@dagrejs/dagre'
  import { Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-svelte'

  interface ColumnInfo {
    name: string
    dataType: string
    nullable: boolean
    isPrimaryKey: boolean
    defaultValue: string | null
  }

  interface FKInfo {
    constraintName: string
    localColumns: string[]
    refSchema: string
    refTable: string
    refColumns: string[]
    onDelete: string
    onUpdate: string
  }

  interface TableInfo {
    name: string
    columns: ColumnInfo[]
    indexes: string[]
    sequences: string[]
    foreignKeys: FKInfo[]
  }

  interface NodeLayout {
    table: TableInfo
    x: number
    y: number
    width: number
    height: number
  }

  interface EdgeLayout {
    from: string
    to: string
    points: { x: number; y: number }[]
  }

  let {
    connectionId,
    schemaName,
  }: {
    connectionId: number
    schemaName: string
  } = $props()

  const NODE_WIDTH = 220
  const HEADER_HEIGHT = 30
  const ROW_HEIGHT = 20

  let loading = $state(true)
  let error = $state<string | null>(null)
  let nodes = $state<NodeLayout[]>([])
  let edges = $state<EdgeLayout[]>([])

  let scale = $state(1)
  let tx = $state(30)
  let ty = $state(30)
  let isPanning = $state(false)
  let panStartX = 0
  let panStartY = 0
  let panStartTx = 0
  let panStartTy = 0

  let svgEl: SVGSVGElement | undefined = $state(undefined)

  function nodeHeight(table: TableInfo): number {
    return HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + 4
  }

  async function load(): Promise<void> {
    loading = true
    error = null
    try {
      const objects = await window.api.getSchemaObjects(connectionId, schemaName)
      const tables = objects.tables

      if (tables.length === 0) {
        nodes = []
        edges = []
        return
      }

      const g = new dagre.graphlib.Graph()
      g.setDefaultEdgeLabel(() => ({}))
      g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100, marginx: 40, marginy: 40 })

      for (const table of tables) {
        g.setNode(table.name, { width: NODE_WIDTH, height: nodeHeight(table) })
      }

      const tableSet = new Set(tables.map((t) => t.name))
      for (const table of tables) {
        for (const fk of table.foreignKeys) {
          if (tableSet.has(fk.refTable) && fk.refTable !== table.name) {
            g.setEdge(table.name, fk.refTable)
          }
        }
      }

      dagre.layout(g)

      const tableMap = new Map(tables.map((t) => [t.name, t]))
      nodes = g.nodes().map((name) => {
        const n = g.node(name)
        const table = tableMap.get(name)!
        return {
          table,
          x: n.x - NODE_WIDTH / 2,
          y: n.y - nodeHeight(table) / 2,
          width: NODE_WIDTH,
          height: nodeHeight(table),
        }
      })

      edges = g.edges().map((e) => {
        const edge = g.edge(e) as { points?: { x: number; y: number }[] }
        return {
          from: e.v,
          to: e.w,
          points: edge.points ?? [],
        }
      })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  function pointsToPath(points: { x: number; y: number }[]): string {
    if (points.length < 2) return ''
    const [first, ...rest] = points
    let d = `M ${first.x} ${first.y}`
    for (const p of rest) d += ` L ${p.x} ${p.y}`
    return d
  }

  function handleWheel(e: WheelEvent): void {
    e.preventDefault()
    if (!svgEl) return
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.min(Math.max(scale * factor, 0.15), 4)
    const rect = svgEl.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    tx = mx - (mx - tx) * (newScale / scale)
    ty = my - (my - ty) * (newScale / scale)
    scale = newScale
  }

  function handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    isPanning = true
    panStartX = e.clientX
    panStartY = e.clientY
    panStartTx = tx
    panStartTy = ty
  }

  function handleMouseMove(e: MouseEvent): void {
    if (!isPanning) return
    tx = panStartTx + (e.clientX - panStartX)
    ty = panStartTy + (e.clientY - panStartY)
  }

  function handleMouseUp(): void {
    isPanning = false
  }

  function zoomIn(): void {
    scale = Math.min(scale * 1.25, 4)
  }

  function zoomOut(): void {
    scale = Math.max(scale * 0.8, 0.15)
  }

  function resetView(): void {
    scale = 1
    tx = 30
    ty = 30
  }

  onMount(() => {
    void load()
  })
</script>

<div class="relative flex h-full w-full flex-col overflow-hidden bg-background">
  {#if loading}
    <div class="flex h-full items-center justify-center gap-2 text-muted-foreground">
      <Loader2 class="h-4 w-4 animate-spin" />
      <span class="text-sm">ERD 로딩 중...</span>
    </div>
  {:else if error}
    <div class="flex h-full items-center justify-center px-8">
      <p class="text-sm text-destructive">{error}</p>
    </div>
  {:else if nodes.length === 0}
    <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
      스키마에 테이블이 없습니다.
    </div>
  {:else}
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <span class="text-xs text-muted-foreground">
        {schemaName} &mdash; 테이블 {nodes.length}개, 관계 {edges.length}개
      </span>
      <div class="ml-auto flex items-center gap-0.5">
        <button class="rounded p-1 hover:bg-accent" onclick={zoomIn} title="확대">
          <ZoomIn class="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button class="rounded p-1 hover:bg-accent" onclick={zoomOut} title="축소">
          <ZoomOut class="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button class="rounded p-1 hover:bg-accent" onclick={resetView} title="초기화">
          <Maximize2 class="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>

    <svg
      bind:this={svgEl}
      class="flex-1 select-none"
      style="cursor: {isPanning ? 'grabbing' : 'grab'}"
      onwheel={handleWheel}
      onmousedown={handleMouseDown}
      onmousemove={handleMouseMove}
      onmouseup={handleMouseUp}
      onmouseleave={handleMouseUp}
    >
      <defs>
        <marker
          id="erd-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L8,3 z" style="fill: var(--color-muted-foreground)" />
        </marker>
      </defs>

      <g transform="translate({tx}, {ty}) scale({scale})">
        <!-- Edges -->
        {#each edges as edge}
          <path
            d={pointsToPath(edge.points)}
            fill="none"
            style="stroke: var(--color-muted-foreground)"
            stroke-width="1.2"
            stroke-opacity="0.5"
            marker-end="url(#erd-arrow)"
          />
        {/each}

        <!-- Nodes -->
        {#each nodes as node}
          {@const h = node.height}
          <g transform="translate({node.x}, {node.y})">
            <!-- Card background -->
            <rect
              width={NODE_WIDTH}
              height={h}
              rx="5"
              style="fill: var(--color-card); stroke: var(--color-border)"
              stroke-width="1"
            />
            <!-- Header background -->
            <rect
              width={NODE_WIDTH}
              height={HEADER_HEIGHT}
              rx="5"
              style="fill: var(--color-primary)"
            />
            <rect
              y={HEADER_HEIGHT - 5}
              width={NODE_WIDTH}
              height="5"
              style="fill: var(--color-primary)"
            />
            <!-- Table name -->
            <text
              x={NODE_WIDTH / 2}
              y={HEADER_HEIGHT / 2 + 1}
              text-anchor="middle"
              dominant-baseline="middle"
              font-size="11"
              font-weight="600"
              font-family="monospace"
              style="fill: var(--color-primary-foreground)"
            >{node.table.name}</text>

            <!-- Columns -->
            {#each node.table.columns as col, i}
              {@const cy = HEADER_HEIGHT + i * ROW_HEIGHT + 2}
              <!-- Alternating row bg -->
              {#if i % 2 === 1}
                <rect
                  x="1"
                  y={cy}
                  width={NODE_WIDTH - 2}
                  height={ROW_HEIGHT}
                  style="fill: var(--color-muted)"
                  opacity="0.4"
                />
              {/if}
              <!-- PK indicator -->
              {#if col.isPrimaryKey}
                <circle
                  cx="8"
                  cy={cy + ROW_HEIGHT / 2}
                  r="3"
                  fill="#f59e0b"
                />
              {:else}
                <circle
                  cx="8"
                  cy={cy + ROW_HEIGHT / 2}
                  r="2"
                  style="fill: var(--color-border)"
                />
              {/if}
              <!-- Column name -->
              <text
                x="18"
                y={cy + ROW_HEIGHT / 2 + 1}
                dominant-baseline="middle"
                font-size="10"
                font-family="monospace"
                font-weight={col.isPrimaryKey ? '600' : '400'}
                style="fill: var(--color-foreground)"
              >{col.name}</text>
              <!-- Data type -->
              <text
                x={NODE_WIDTH - 6}
                y={cy + ROW_HEIGHT / 2 + 1}
                text-anchor="end"
                dominant-baseline="middle"
                font-size="9"
                font-family="monospace"
                style="fill: var(--color-muted-foreground)"
              >{col.dataType}</text>
            {/each}
          </g>
        {/each}
      </g>
    </svg>
  {/if}
</div>
