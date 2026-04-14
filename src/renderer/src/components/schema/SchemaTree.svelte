<script lang="ts">
  import {
    ChevronRight,
    Loader2,
    Table2,
    Eye,
    Layers,
    FunctionSquare,
    Columns3,
    FileKey,
    KeyRound,
  } from 'lucide-svelte'
  import SchemaObjectContextMenu from './SchemaObjectContextMenu.svelte'
  import CsvImportDialog from '../table/CsvImportDialog.svelte'
  import * as ContextMenu from '$lib/components/ui/context-menu'
  import { openSqlEditor, selectData, viewDDL, copyDDL, copyDDLMultiple, dropObject, refreshSchemaObjects } from '$lib/actions/sidebar-actions'

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

  interface IndexInfo {
    name: string
    unique: boolean
    columns: string[]
  }

  interface TableInfo {
    name: string
    columns: ColumnInfo[]
    indexes: IndexInfo[]
    sequences: string[]
    foreignKeys: FKInfo[]
  }

  interface ViewInfo {
    name: string
    columns: ColumnInfo[]
  }

  interface MatViewInfo {
    name: string
    columns: ColumnInfo[]
    indexes: IndexInfo[]
  }

  interface SchemaObjects {
    tables: TableInfo[]
    views: ViewInfo[]
    materialized_views: MatViewInfo[]
    functions: string[]
  }

  let {
    connectionId,
    dbType,
    schemaName,
    active,
    onSelect,
    onCreateTable,
    onAlterTable,
    onCreateView,
    onAlterView,
    onDropView,
    onCreateIndex,
    onDropIndex
  }: {
    connectionId: number
    dbType: string
    schemaName: string
    active: boolean
    onSelect: () => void
    onCreateTable: () => void
    onAlterTable: (info: { tableName: string; columns: ColumnInfo[]; foreignKeys: FKInfo[] }) => void
    onCreateView: () => void
    onAlterView: (info: { viewName: string }) => void
    onDropView: (viewName: string) => void
    onCreateIndex: (info: { tableName: string; columns: ColumnInfo[] }) => void
    onDropIndex: (info: { tableName: string; indexName: string }) => void
  } = $props()

  let objects = $state<SchemaObjects | null>(null)
  let loadingObjects = $state(false)
  let loaded = $state(false)
  let expandedNodes = $state<Record<string, boolean>>({})
  let selectedTables = $state<Set<string>>(new Set())
  let lastSelectedTable = $state<string | null>(null)
  let selectedView = $state<string | null>(null)
  let csvImportOpen = $state(false)
  let csvImportTarget = $state<{ tableName: string; columns: ColumnInfo[] } | null>(null)

  async function load(): Promise<void> {
    if (loaded) return
    loadingObjects = true
    try {
      objects = await window.api.getSchemaObjects(connectionId, schemaName)
    } catch (err) {
      console.error('스키마 오브젝트 조회 실패:', err)
      objects = { tables: [], views: [], materialized_views: [], functions: [] }
    } finally {
      loadingObjects = false
      loaded = true
    }
  }

  function toggle(key: string): void {
    expandedNodes[key] = !expandedNodes[key]
  }

  async function reloadObjects(): Promise<void> {
    loaded = false
    selectedTables = new Set()
    lastSelectedTable = null
    selectedView = null
    await refreshSchemaObjects(load)
  }

  $effect(() => {
    if (!active) {
      selectedTables = new Set()
      lastSelectedTable = null
      selectedView = null
    }
  })

  function handleViewClick(name: string): void {
    onSelect()
    selectedView = name
    selectedTables = new Set()
    lastSelectedTable = null
  }

  function handleTableClick(e: MouseEvent, name: string): void {
    onSelect()
    selectedView = null
    const tableNames = objects?.tables.map((t) => t.name) ?? []
    if (e.shiftKey && lastSelectedTable && tableNames.length > 0) {
      const fromIdx = tableNames.indexOf(lastSelectedTable)
      const toIdx = tableNames.indexOf(name)
      const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
      const next = new Set(selectedTables)
      for (let i = start; i <= end; i++) next.add(tableNames[i])
      selectedTables = next
    } else if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedTables)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      selectedTables = next
      lastSelectedTable = name
    } else {
      selectedTables = new Set([name])
      lastSelectedTable = name
    }
  }

  function topoSortTables(names: string[]): string[] {
    const nameSet = new Set(names)
    const tableMap = new Map(objects?.tables.map((t) => [t.name, t]) ?? [])
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const result: string[] = []

    function visit(name: string): void {
      if (visited.has(name)) return
      if (visiting.has(name)) return
      visiting.add(name)
      const table = tableMap.get(name)
      if (table) {
        for (const fk of table.foreignKeys) {
          if (nameSet.has(fk.refTable)) visit(fk.refTable)
        }
      }
      visiting.delete(name)
      visited.add(name)
      result.push(name)
    }

    for (const name of names) visit(name)
    return result
  }

  $effect(() => {
    void load()
  })
</script>

{#snippet chevron(key: string, size?: string)}
  <ChevronRight
    class="{size ?? 'h-2.5 w-2.5'} text-muted-foreground transition-transform duration-150 {expandedNodes[key] ? 'rotate-90' : ''}"
  />
{/snippet}

{#snippet columnRow(col: ColumnInfo)}
  <div class="flex items-center gap-1 px-2 py-0.5">
    <span class="relative shrink-0">
      {#if col.isPrimaryKey}
        <KeyRound class="h-2.5 w-2.5 text-amber-500" />
      {:else}
        <Columns3 class="h-2.5 w-2.5 text-muted-foreground" />
      {/if}
      {#if !col.nullable}
        <span class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-red-500"></span>
      {/if}
    </span>
    <span class="truncate text-[11px] text-foreground">{col.name}</span>
    <span class="shrink-0 text-[9px] text-muted-foreground">({col.dataType})</span>
    {#if !col.nullable}
      <span class="shrink-0 rounded bg-red-500/15 px-1 text-[8px] font-medium text-red-500">not null</span>
    {/if}
  </div>
{/snippet}

{#snippet indexRow(idx: IndexInfo, tableName: string)}
  <ContextMenu.Root>
    <ContextMenu.Trigger>
      <div class="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-accent/60 cursor-default">
        <FileKey class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
        <span class="truncate text-[11px] text-foreground">{idx.name}</span>
        {#if idx.unique}
          <span class="shrink-0 rounded bg-amber-500/15 px-1 text-[8px] font-medium text-amber-600 dark:text-amber-400">UNIQUE</span>
        {/if}
        <span class="shrink-0 text-[9px] text-muted-foreground">({idx.columns.join(', ')})</span>
      </div>
    </ContextMenu.Trigger>
    <ContextMenu.Content class="w-36">
      <ContextMenu.Item
        class="text-destructive focus:text-destructive"
        onclick={() => onDropIndex({ tableName, indexName: idx.name })}
      >
        인덱스 삭제
      </ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Root>
{/snippet}

{#if loadingObjects}
  <div class="flex items-center gap-1.5 px-2 py-1">
    <Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
    <span class="text-[10px] text-muted-foreground">로딩 중...</span>
  </div>
{:else if objects}

  {#if objects.tables.length > 0}
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <button class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent" onclick={() => toggle('tables')}>
            {@render chevron('tables')}
            <Table2 class="h-3 w-3 shrink-0 text-muted-foreground" />
            <span class="text-[11px] text-muted-foreground">Tables ({objects.tables.length})</span>
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Content class="w-40">
          <ContextMenu.Item onclick={onCreateTable}>테이블 생성</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
      {#if expandedNodes['tables']}
        <div class="ml-3 border-l border-border pl-1">
          {#each objects.tables as table}
            {@const tKey = `t:${table.name}`}
            <div>
              <SchemaObjectContextMenu
                objectType="table"
                {dbType}
                onSelectData={() => selectData({ connectionId, dbType, schemaName, objectName: table.name, objectType: 'table' })}
                onOpenEditor={() => openSqlEditor({ connectionId, dbType, schemaName, objectName: table.name, objectType: 'table' })}
                onViewDDL={() => viewDDL({ connectionId, dbType, schemaName, objectName: table.name, objectType: 'table' })}
                onCopyDDL={() =>
                  selectedTables.has(table.name) && selectedTables.size > 1
                    ? copyDDLMultiple(connectionId, schemaName, topoSortTables([...selectedTables]))
                    : copyDDL({ connectionId, dbType, schemaName, objectName: table.name, objectType: 'table' })}
                onDrop={() => dropObject({ connectionId, dbType, schemaName, objectName: table.name, objectType: 'table' })}
                onRefresh={reloadObjects}
                onAlter={() => onAlterTable({ tableName: table.name, columns: table.columns, foreignKeys: table.foreignKeys })}
                onImportCsv={() => { csvImportTarget = { tableName: table.name, columns: table.columns }; csvImportOpen = true }}
              >
                <div
                  class="flex w-full items-center rounded-md px-1 py-0.5 transition-colors
                    {selectedTables.has(table.name) ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/60 text-foreground'}"
                >
                  <button
                    class="shrink-0 p-0.5"
                    onclick={(e) => { e.stopPropagation(); toggle(tKey) }}
                  >
                    {@render chevron(tKey)}
                  </button>
                  <button
                    class="flex flex-1 items-center gap-1 min-w-0"
                    onclick={(e) => handleTableClick(e, table.name)}
                    ondblclick={() => selectData({ connectionId, dbType, schemaName, objectName: table.name, objectType: 'table' })}
                  >
                    <Table2 class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    <span class="truncate text-[11px]">{table.name}</span>
                  </button>
                </div>
              </SchemaObjectContextMenu>
              {#if expandedNodes[tKey]}
                <div class="ml-3 border-l border-border pl-1">
                  <!-- Columns -->
                  <div>
                    <button
                      class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent"
                      onclick={() => toggle(`${tKey}:cols`)}
                    >
                      {@render chevron(`${tKey}:cols`)}
                      <Columns3 class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                      <span class="text-[10px] text-muted-foreground">Columns ({table.columns.length})</span>
                    </button>
                    {#if expandedNodes[`${tKey}:cols`]}
                      <div class="ml-3 border-l border-border pl-1">
                        {#each table.columns as col}
                          {@render columnRow(col)}
                        {/each}
                      </div>
                    {/if}
                  </div>

                  <!-- Foreign Keys -->
                  {#if table.foreignKeys.length > 0}
                    <div>
                      <button
                        class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent"
                        onclick={() => toggle(`${tKey}:fks`)}
                      >
                        {@render chevron(`${tKey}:fks`)}
                        <FileKey class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                        <span class="text-[10px] text-muted-foreground">Foreign Keys ({table.foreignKeys.length})</span>
                      </button>
                      {#if expandedNodes[`${tKey}:fks`]}
                        <div class="ml-3 border-l border-border pl-1">
                          {#each table.foreignKeys as fk}
                            <div class="flex flex-col px-2 py-0.5 gap-0.5">
                              <div class="flex items-center gap-1">
                                <FileKey class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                                <span class="truncate text-[11px] text-foreground font-medium">{fk.constraintName}</span>
                              </div>
                              <span class="text-[10px] text-muted-foreground pl-3.5 truncate">
                                ({fk.localColumns.join(', ')}) → {fk.refSchema}.{fk.refTable}({fk.refColumns.join(', ')})
                              </span>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}

                  <!-- Indexes -->
                  {#if table.indexes.length > 0 || dbType !== 'sqlite'}
                    <div>
                      <ContextMenu.Root>
                        <ContextMenu.Trigger>
                          <button
                            class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent"
                            onclick={() => toggle(`${tKey}:idx`)}
                          >
                            {@render chevron(`${tKey}:idx`)}
                            <FileKey class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                            <span class="text-[10px] text-muted-foreground">Indexes ({table.indexes.length})</span>
                          </button>
                        </ContextMenu.Trigger>
                        {#if dbType !== 'sqlite'}
                          <ContextMenu.Content class="w-36">
                            <ContextMenu.Item onclick={() => onCreateIndex({ tableName: table.name, columns: table.columns })}>인덱스 생성</ContextMenu.Item>
                          </ContextMenu.Content>
                        {/if}
                      </ContextMenu.Root>
                      {#if expandedNodes[`${tKey}:idx`]}
                        <div class="ml-3 border-l border-border pl-1">
                          {#each table.indexes as idx}
                            {@render indexRow(idx, table.name)}
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if objects.views.length > 0 || dbType !== 'sqlite'}
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <button class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent" onclick={() => toggle('views')}>
            {@render chevron('views')}
            <Eye class="h-3 w-3 shrink-0 text-muted-foreground" />
            <span class="text-[11px] text-muted-foreground">Views ({objects.views.length})</span>
          </button>
        </ContextMenu.Trigger>
        {#if dbType !== 'sqlite'}
          <ContextMenu.Content class="w-40">
            <ContextMenu.Item onclick={onCreateView}>뷰 생성</ContextMenu.Item>
          </ContextMenu.Content>
        {/if}
      </ContextMenu.Root>
      {#if expandedNodes['views']}
        <div class="ml-3 border-l border-border pl-1">
          {#each objects.views as view}
            {@const vKey = `v:${view.name}`}
            <div>
              <SchemaObjectContextMenu
                objectType="view"
                {dbType}
                onSelectData={() => selectData({ connectionId, dbType, schemaName, objectName: view.name, objectType: 'view' })}
                onOpenEditor={() => openSqlEditor({ connectionId, dbType, schemaName, objectName: view.name, objectType: 'view' })}
                onViewDDL={() => viewDDL({ connectionId, dbType, schemaName, objectName: view.name, objectType: 'view' })}
                onDrop={() => onDropView(view.name)}
                onRefresh={reloadObjects}
                onAlter={() => onAlterView({ viewName: view.name })}
              >
                <div
                  class="flex w-full items-center rounded-md px-1 py-0.5 transition-colors
                    {selectedView === view.name ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/60 text-foreground'}"
                >
                  <button
                    class="shrink-0 p-0.5"
                    onclick={(e) => { e.stopPropagation(); toggle(vKey) }}
                  >
                    {@render chevron(vKey)}
                  </button>
                  <button
                    class="flex flex-1 items-center gap-1 min-w-0"
                    onclick={() => handleViewClick(view.name)}
                    ondblclick={() => selectData({ connectionId, dbType, schemaName, objectName: view.name, objectType: 'view' })}
                  >
                    <Eye class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    <span class="truncate text-[11px]">{view.name}</span>
                  </button>
                </div>
              </SchemaObjectContextMenu>
              {#if expandedNodes[vKey]}
                <div class="ml-3 border-l border-border pl-1">
                  {#each view.columns as col}
                    {@render columnRow(col)}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if objects.materialized_views.length > 0}
    <div>
      <button class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent" onclick={() => toggle('matviews')}>
        {@render chevron('matviews')}
        <Layers class="h-3 w-3 shrink-0 text-muted-foreground" />
        <span class="text-[11px] text-muted-foreground">Materialized Views ({objects.materialized_views.length})</span>
      </button>
      {#if expandedNodes['matviews']}
        <div class="ml-3 border-l border-border pl-1">
          {#each objects.materialized_views as mv}
            {@const mvKey = `mv:${mv.name}`}
            <div>
              <SchemaObjectContextMenu
                objectType="matview"
                {dbType}
                onSelectData={() => selectData({ connectionId, dbType, schemaName, objectName: mv.name, objectType: 'matview' })}
                onOpenEditor={() => openSqlEditor({ connectionId, dbType, schemaName, objectName: mv.name, objectType: 'matview' })}
                onViewDDL={() => viewDDL({ connectionId, dbType, schemaName, objectName: mv.name, objectType: 'matview' })}
                onDrop={() => dropObject({ connectionId, dbType, schemaName, objectName: mv.name, objectType: 'matview' })}
                onRefresh={reloadObjects}
              >
              <button class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent" onclick={() => toggle(mvKey)}>
                {@render chevron(mvKey)}
                <Layers class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                <span class="truncate text-[11px] text-foreground">{mv.name}</span>
              </button>
              </SchemaObjectContextMenu>
              {#if expandedNodes[mvKey]}
                <div class="ml-3 border-l border-border pl-1">
                  {#each mv.columns as col}
                    {@render columnRow(col)}
                  {/each}
                  {#if mv.indexes.length > 0}
                    <div class="mt-0.5">
                      <button class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent" onclick={() => toggle(`${mvKey}:idx`)}>
                        {@render chevron(`${mvKey}:idx`)}
                        <FileKey class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                        <span class="text-[10px] text-muted-foreground">Indexes ({mv.indexes.length})</span>
                      </button>
                      {#if expandedNodes[`${mvKey}:idx`]}
                        <div class="ml-3 border-l border-border pl-1">
                          {#each mv.indexes as idx}
                            {@render indexRow(idx, mv.name)}
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if objects.functions.length > 0}
    <div>
      <button class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent" onclick={() => toggle('functions')}>
        {@render chevron('functions')}
        <FunctionSquare class="h-3 w-3 shrink-0 text-muted-foreground" />
        <span class="text-[11px] text-muted-foreground">Functions ({objects.functions.length})</span>
      </button>
      {#if expandedNodes['functions']}
        <div class="ml-3 border-l border-border pl-1">
          {#each objects.functions as fn}
            <SchemaObjectContextMenu
              objectType="function"
              {dbType}
              onSelectData={() => selectData({ connectionId, dbType, schemaName, objectName: fn, objectType: 'function' })}
              onOpenEditor={() => openSqlEditor({ connectionId, dbType, schemaName, objectName: fn, objectType: 'function' })}
              onViewDDL={() => viewDDL({ connectionId, dbType, schemaName, objectName: fn, objectType: 'function' })}
              onDrop={() => dropObject({ connectionId, dbType, schemaName, objectName: fn, objectType: 'function' })}
              onRefresh={reloadObjects}
            >
            <div class="flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-accent">
              <FunctionSquare class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
              <span class="truncate text-[11px] text-foreground">{fn}</span>
            </div>
            </SchemaObjectContextMenu>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

{/if}

{#if csvImportOpen && csvImportTarget}
  <CsvImportDialog
    open={csvImportOpen}
    {connectionId}
    {schemaName}
    tableName={csvImportTarget.tableName}
    tableColumns={csvImportTarget.columns}
    onImported={reloadObjects}
    onClose={() => { csvImportOpen = false; csvImportTarget = null }}
  />
{/if}
