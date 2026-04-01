import { get } from 'svelte/store'
import { connections } from '../stores/connections'
import { tabsStore } from '../stores/tabs'
import { ddlDialogStore } from '../stores/ddl-dialog'

export interface SidebarActionContext {
  connectionId: number
  dbType: string
  schemaName?: string
  objectName?: string
  objectType?: 'table' | 'view' | 'matview' | 'function'
}

export function openSqlEditor(ctx: SidebarActionContext): void {
  const conn = get(connections).find((c) => c.id === ctx.connectionId)
  const title = conn?.name ?? `연결 ${ctx.connectionId}`
  tabsStore.openTab({
    connectionId: ctx.connectionId,
    dbType: ctx.dbType,
    schemaName: ctx.schemaName,
    title,
  })
}

export function selectData(ctx: SidebarActionContext): void {
  if (!ctx.objectName || !ctx.schemaName) return
  const title = `${ctx.schemaName}.${ctx.objectName}`
  tabsStore.openTab({
    connectionId: ctx.connectionId,
    dbType: ctx.dbType,
    schemaName: ctx.schemaName,
    objectName: ctx.objectName,
    objectType: ctx.objectType,
    title,
    type: 'data',
  })
}

export async function copyDDL(ctx: SidebarActionContext): Promise<void> {
  if (!ctx.objectName || !ctx.objectType || !ctx.schemaName) return
  const ddl = await window.api.getObjectDDL(ctx.connectionId, ctx.schemaName, ctx.objectName, ctx.objectType)
  await navigator.clipboard.writeText(ddl)
}

export async function copyDDLMultiple(
  connectionId: number,
  schemaName: string,
  tableNames: string[]
): Promise<void> {
  const ddls = await Promise.all(
    tableNames.map((name) => window.api.getObjectDDL(connectionId, schemaName, name, 'table'))
  )
  await navigator.clipboard.writeText(ddls.join('\n\n'))
}

export async function viewDDL(ctx: SidebarActionContext): Promise<void> {
  if (!ctx.objectName || !ctx.objectType || !ctx.schemaName) return
  const title = `${ctx.schemaName}.${ctx.objectName}`
  ddlDialogStore.set({ open: true, title, ddl: '', loading: true, error: null })
  try {
    const ddl = await window.api.getObjectDDL(ctx.connectionId, ctx.schemaName, ctx.objectName, ctx.objectType)
    ddlDialogStore.update((s) => ({ ...s, ddl, loading: false }))
  } catch (err) {
    ddlDialogStore.update((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }))
  }
}

export function dropObject(ctx: SidebarActionContext): void {
  console.log('dropObject', ctx)
}

export function createTable(ctx: SidebarActionContext): void {
  console.log('createTable', ctx)
}

export async function refreshSchemas(
  connectionId: number,
  onRefresh: (schemas: { name: string; owned: boolean }[]) => void
): Promise<void> {
  const schemas = await window.api.getSchemas(connectionId)
  onRefresh(schemas)
}

export async function refreshSchemaObjects(reload: () => Promise<void>): Promise<void> {
  await reload()
}
