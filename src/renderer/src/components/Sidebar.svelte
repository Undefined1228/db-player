<script lang="ts">
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import * as AlertDialog from '$lib/components/ui/alert-dialog'
  import { Plus, Trash2, ChevronRight, Loader2, FolderOpen } from 'lucide-svelte'
  import { DbIcon } from './icons'
  import SchemaTree from './SchemaTree.svelte'
  import ConnectionDialog from './ConnectionDialog.svelte'
  import ConnectionContextMenu from './ConnectionContextMenu.svelte'
  import CreateSchemaDialog from './CreateSchemaDialog.svelte'
  import EditSchemaDialog from './EditSchemaDialog.svelte'
  import DropSchemaDialog from './DropSchemaDialog.svelte'
  import CreateTableDialog from './CreateTableDialog.svelte'
  import AlterTableDialog from './AlterTableDialog.svelte'
  import { connections, loadConnections, removeConnection, type Connection } from '$lib/stores/connections'
  import { openSqlEditor, createTable, refreshSchemas } from '$lib/actions/sidebar-actions'
  import { tabsStore } from '$lib/stores/tabs'

  let dialogOpen = $state(false)
  let editDialogOpen = $state(false)
  let editTarget = $state<ConnectionWithPassword | null>(null)
  let deleteDialogOpen = $state(false)
  let deleteTarget = $state<Connection | null>(null)
  let createSchemaDialogOpen = $state(false)
  let createSchemaConnId = $state<number | null>(null)

  interface SchemaTarget { connectionId: number; dbType: string; schemaName: string }

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

  interface AlterTableTarget extends SchemaTarget {
    tableName: string
    columns: ColumnInfo[]
    foreignKeys: FKInfo[]
  }

  let editSchemaDialogOpen = $state(false)
  let editSchemaTarget = $state<SchemaTarget | null>(null)
  let dropSchemaDialogOpen = $state(false)
  let dropSchemaTarget = $state<SchemaTarget | null>(null)
  let createTableDialogOpen = $state(false)
  let createTableTarget = $state<SchemaTarget | null>(null)
  let alterTableDialogOpen = $state(false)
  let alterTableTarget = $state<AlterTableTarget | null>(null)

  let expanded = $state<Record<number, boolean>>({})
  interface SchemaInfo { name: string; owned: boolean }
  let schemas = $state<Record<number, SchemaInfo[]>>({})
  let loading = $state<Record<number, boolean>>({})
  let expandedSchemas = $state<Record<string, boolean>>({})
  let activeSchemaKey = $state<string | null>(null)

  async function handleEdit(conn: Connection): Promise<void> {
    const data = await window.api.getConnection(conn.id)
    if (!data) return
    editTarget = data
    editDialogOpen = true
  }

  function confirmDelete(conn: Connection): void {
    deleteTarget = conn
    deleteDialogOpen = true
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return
    await removeConnection(deleteTarget.id)
    delete expanded[deleteTarget.id]
    delete schemas[deleteTarget.id]
    deleteTarget = null
    deleteDialogOpen = false
  }

  async function toggleExpand(conn: Connection): Promise<void> {
    const id = conn.id
    if (expanded[id]) {
      expanded[id] = false
      return
    }

    expanded[id] = true

    if (!schemas[id]) {
      loading[id] = true
      try {
        schemas[id] = await window.api.getSchemas(id)
      } catch (err) {
        console.error('스키마 조회 실패:', err)
        schemas[id] = []
      } finally {
        loading[id] = false
      }
    }
  }

  async function handleRefreshSchemas(connId: number): Promise<void> {
    delete schemas[connId]
    loading[connId] = true
    try {
      await refreshSchemas(connId, (result) => {
        schemas[connId] = result
      })
    } finally {
      loading[connId] = false
    }
  }

  onMount(() => {
    loadConnections()
  })
</script>

<div class="flex h-full cursor-default flex-col bg-sidebar-background">
  <div class="flex items-center justify-between border-b border-border px-4 py-2">
    <span class="text-xs font-semibold text-muted-foreground">연결 목록</span>
    <Button variant="ghost" size="icon" class="h-6 w-6" onclick={() => (dialogOpen = true)}>
      <Plus class="h-3.5 w-3.5" />
    </Button>
  </div>
  <div class="flex-1 overflow-y-auto p-2">
    {#if $connections.length === 0}
      <p class="py-6 text-center text-xs text-muted-foreground">DB 연결을 추가하세요</p>
    {:else}
      {#each $connections as conn}
        <div>
          <ConnectionContextMenu
            level="connection"
            dbType={conn.dbType}
            onOpenEditor={() => openSqlEditor({ connectionId: conn.id, dbType: conn.dbType })}
            onRefresh={() => handleRefreshSchemas(conn.id)}
            onEdit={() => handleEdit(conn)}
            onDelete={() => confirmDelete(conn)}
            onCreate={() => createTable({ connectionId: conn.id, dbType: conn.dbType })}
            onCreateSchema={() => { createSchemaConnId = conn.id; createSchemaDialogOpen = true }}
          >
          <div class="group flex items-center gap-1 rounded-md px-1 py-1.5 hover:bg-accent">
            <button
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
              onclick={() => toggleExpand(conn)}
            >
              <ChevronRight
                class="h-3 w-3 text-muted-foreground transition-transform duration-150 {expanded[conn.id] ? 'rotate-90' : ''}"
              />
            </button>
            <DbIcon dbType={conn.dbType} class="h-4 w-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium text-foreground">{conn.name}</div>
              <div class="truncate text-[10px] text-muted-foreground">
                {#if conn.host}{conn.host}{conn.port ? `:${conn.port}` : ''}{/if}
                {#if conn.filePath}{conn.filePath}{/if}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-5 w-5 opacity-0 group-hover:opacity-100"
              onclick={() => confirmDelete(conn)}
            >
              <Trash2 class="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
          </ConnectionContextMenu>

          {#if expanded[conn.id]}
            <div class="ml-5 border-l border-border pl-2">
              {#if loading[conn.id]}
                <div class="flex items-center gap-1.5 px-2 py-1">
                  <Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
                  <span class="text-[10px] text-muted-foreground">로딩 중...</span>
                </div>
              {:else if schemas[conn.id]?.length}
                {#each schemas[conn.id] as schema}
                  {@const schemaKey = `${conn.id}:${schema.name}`}
                  <div>
                    <ConnectionContextMenu
                      level="schema"
                      dbType={conn.dbType}
                      onOpenEditor={() => openSqlEditor({ connectionId: conn.id, dbType: conn.dbType, schemaName: schema.name })}
                      onRefresh={() => handleRefreshSchemas(conn.id)}
                      onEdit={() => { editSchemaTarget = { connectionId: conn.id, schemaName: schema.name }; editSchemaDialogOpen = true }}
                      onDelete={() => { dropSchemaTarget = { connectionId: conn.id, schemaName: schema.name }; dropSchemaDialogOpen = true }}
                      onCreate={() => { createTableTarget = { connectionId: conn.id, dbType: conn.dbType, schemaName: schema.name }; createTableDialogOpen = true }}
                      onOpenErDiagram={() => tabsStore.openTab({ connectionId: conn.id, dbType: conn.dbType, schemaName: schema.name, type: 'erd', title: `ERD: ${schema.name}` })}
                    >
                    <button
                      class="flex w-full items-center gap-1 rounded-md px-1 py-1 hover:bg-accent"
                      onclick={() => (expandedSchemas[schemaKey] = !expandedSchemas[schemaKey])}
                    >
                      <ChevronRight
                        class="h-2.5 w-2.5 text-muted-foreground transition-transform duration-150 {expandedSchemas[schemaKey] ? 'rotate-90' : ''}"
                      />
                      <FolderOpen class="h-3 w-3 shrink-0 {schema.owned ? 'text-foreground' : 'text-muted-foreground'}" />
                      <span class="truncate text-xs {schema.owned ? 'text-foreground' : 'text-muted-foreground'}">{schema.name}</span>
                    </button>
                    </ConnectionContextMenu>
                    {#if expandedSchemas[schemaKey]}
                      <div class="ml-3 border-l border-border pl-1">
                        <SchemaTree
                          connectionId={conn.id}
                          dbType={conn.dbType}
                          schemaName={schema.name}
                          active={activeSchemaKey === schemaKey}
                          onSelect={() => { activeSchemaKey = schemaKey }}
                          onCreateTable={() => { createTableTarget = { connectionId: conn.id, dbType: conn.dbType, schemaName: schema.name }; createTableDialogOpen = true }}
                          onAlterTable={(info) => { alterTableTarget = { connectionId: conn.id, dbType: conn.dbType, schemaName: schema.name, ...info }; alterTableDialogOpen = true }}
                        />
                      </div>
                    {/if}
                  </div>
                {/each}
              {:else}
                <div class="px-2 py-1 text-[10px] text-muted-foreground">스키마 없음</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<ConnectionDialog bind:open={dialogOpen} />
<ConnectionDialog bind:open={editDialogOpen} initialData={editTarget} />
{#if createSchemaConnId !== null}
  <CreateSchemaDialog
    bind:open={createSchemaDialogOpen}
    connectionId={createSchemaConnId}
    onCreated={() => handleRefreshSchemas(createSchemaConnId!)}
  />
{/if}
{#if editSchemaTarget !== null}
  <EditSchemaDialog
    bind:open={editSchemaDialogOpen}
    connectionId={editSchemaTarget.connectionId}
    schemaName={editSchemaTarget.schemaName}
    onEdited={() => handleRefreshSchemas(editSchemaTarget!.connectionId)}
  />
{/if}
{#if dropSchemaTarget !== null}
  <DropSchemaDialog
    bind:open={dropSchemaDialogOpen}
    connectionId={dropSchemaTarget.connectionId}
    schemaName={dropSchemaTarget.schemaName}
    onDropped={() => handleRefreshSchemas(dropSchemaTarget!.connectionId)}
  />
{/if}
{#if createTableTarget !== null}
  <CreateTableDialog
    bind:open={createTableDialogOpen}
    connectionId={createTableTarget.connectionId}
    dbType={createTableTarget.dbType}
    schemaName={createTableTarget.schemaName}
    onCreated={() => handleRefreshSchemas(createTableTarget!.connectionId)}
  />
{/if}
{#if alterTableTarget !== null}
  <AlterTableDialog
    bind:open={alterTableDialogOpen}
    connectionId={alterTableTarget.connectionId}
    dbType={alterTableTarget.dbType}
    schemaName={alterTableTarget.schemaName}
    tableName={alterTableTarget.tableName}
    initialColumns={alterTableTarget.columns}
    initialForeignKeys={alterTableTarget.foreignKeys}
    onAltered={() => handleRefreshSchemas(alterTableTarget!.connectionId)}
  />
{/if}

<AlertDialog.Root bind:open={deleteDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>연결 삭제</AlertDialog.Title>
      <AlertDialog.Description>
        "{deleteTarget?.name}" 연결을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>취소</AlertDialog.Cancel>
      <AlertDialog.Action onclick={handleDelete}>삭제</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
