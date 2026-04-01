import { ElectronAPI } from '@electron-toolkit/preload'

interface ConnectionRecord {
  id: number
  name: string
  dbType: string
  inputMode: string
  host: string | null
  port: number | null
  databaseName: string | null
  username: string | null
  filePath: string | null
  url: string | null
  createdAt: string
  updatedAt: string
}

interface ConnectionWithPassword extends ConnectionRecord {
  password: string
}

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

interface ExplainNode {
  nodeType: string
  cost?: number
  actualTime?: number
  rows?: number
  actualRows?: number
  loops?: number
  relation?: string
  children: ExplainNode[]
  extra: Record<string, unknown>
}

interface QueryHistoryRecord {
  id: number
  connectionId: number
  sql: string
  executedAt: string
  executionTime: number
  success: number
}

interface DbApi {
  testConnection: (params: Record<string, unknown>) => Promise<{ success: boolean; message: string }>
  saveConnection: (params: Record<string, unknown>) => Promise<ConnectionRecord>
  listConnections: () => Promise<ConnectionRecord[]>
  deleteConnection: (id: number) => Promise<{ success: true }>
  getConnection: (id: number) => Promise<ConnectionWithPassword | null>
  getSchemas: (connectionId: number) => Promise<{ name: string; owned: boolean }[]>
  getRoles: (connectionId: number) => Promise<string[]>
  createSchema: (connectionId: number, schemaName: string, owner?: string) => Promise<{ success: true }>
  getSchemaOwner: (connectionId: number, schemaName: string) => Promise<string>
  alterSchema: (connectionId: number, schemaName: string, newName?: string, newOwner?: string) => Promise<{ success: true }>
  dropSchema: (connectionId: number, schemaName: string, cascade: boolean) => Promise<{ success: true }>
  getTableNames: (connectionId: number, schemaName: string) => Promise<string[]>
  getColumnNames: (connectionId: number, schemaName: string, tableName: string) => Promise<string[]>
  createTable: (connectionId: number, params: Record<string, unknown>) => Promise<{ success: true }>
  alterTable: (connectionId: number, params: Record<string, unknown>) => Promise<{ success: true }>
  getObjectDDL: (connectionId: number, schemaName: string, objectName: string, objectType: string) => Promise<string>
  selectAll: (connectionId: number, schemaName: string, tableName: string, params: {
    limit: number
    offset: number
    orderBy: { col: string; dir: 'asc' | 'desc' }[]
    search: string
  }) => Promise<{ columns: string[]; primaryKeys: string[]; rows: Record<string, unknown>[]; totalCount: number; columnDefaults: Record<string, string | null>; columnTypes: Record<string, string> }>
  executeDataChanges: (connectionId: number, params: {
    schemaName: string
    tableName: string
    primaryKeys: string[]
    inserts: Record<string, unknown>[]
    updates: { original: Record<string, unknown>; changes: Record<string, unknown> }[]
    deletes: Record<string, unknown>[]
  }) => Promise<{ success: true }>
  executeQuery: (connectionId: number, sql: string) => Promise<
    | { ok: true; columns: string[]; rows: Record<string, unknown>[]; affectedRows: number | null; columnTypes: Record<string, string> }
    | { ok: false; message: string; position?: number }
  >
  cancelQuery: (connectionId: number) => Promise<{ ok: boolean }>
  executeQueryBatch: (connectionId: number, sqls: string[], stopOnError: boolean, useTransaction: boolean) => Promise<{
    results: Array<
      | { ok: true; columns: string[]; rows: Record<string, unknown>[]; affectedRows: number | null; executionTime: number; columnTypes: Record<string, string> }
      | { ok: false; message: string; position?: number; executionTime: number; skipped?: true }
    >
    transactionResult?: 'committed' | 'rolledback'
  }>
  getCompletionSchema: (connectionId: number, schemaName?: string) => Promise<Record<string, string[]>>
  addQueryHistory: (params: { connectionId: number; sql: string; executedAt: string; executionTime: number; success: boolean }) => Promise<{ success: true }>
  getQueryHistory: (connectionId: number) => Promise<QueryHistoryRecord[]>
  explainQuery: (connectionId: number, sql: string) => Promise<
    | { ok: true; plan: ExplainNode; totalTime?: number }
    | { ok: false; message: string }
  >
  onMenuNewTab: (callback: () => void) => void
  onMenuCloseTab: (callback: () => void) => void
  getSchemaObjects: (connectionId: number, schemaName: string) => Promise<{
    tables: { name: string; columns: ColumnInfo[]; indexes: string[]; sequences: string[]; foreignKeys: FKInfo[] }[]
    views: { name: string; columns: ColumnInfo[] }[]
    materialized_views: { name: string; columns: ColumnInfo[]; indexes: string[] }[]
    functions: string[]
  }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DbApi
  }
}
