import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  testConnection: (params: Record<string, unknown>) =>
    ipcRenderer.invoke('db:test-connection', params),
  saveConnection: (params: Record<string, unknown>) =>
    ipcRenderer.invoke('conn:save', params),
  listConnections: () =>
    ipcRenderer.invoke('conn:list'),
  deleteConnection: (id: number) =>
    ipcRenderer.invoke('conn:delete', id),
  getConnection: (id: number) =>
    ipcRenderer.invoke('conn:get', id),
  getSchemas: (connectionId: number) =>
    ipcRenderer.invoke('db:schemas', connectionId),
  getSchemaObjects: (connectionId: number, schemaName: string) =>
    ipcRenderer.invoke('db:schema-objects', connectionId, schemaName),
  getRoles: (connectionId: number) =>
    ipcRenderer.invoke('db:roles', connectionId),
  createSchema: (connectionId: number, schemaName: string, owner?: string) =>
    ipcRenderer.invoke('schema:create', connectionId, schemaName, owner),
  getSchemaOwner: (connectionId: number, schemaName: string) =>
    ipcRenderer.invoke('schema:get-owner', connectionId, schemaName),
  alterSchema: (connectionId: number, schemaName: string, newName?: string, newOwner?: string) =>
    ipcRenderer.invoke('schema:alter', connectionId, schemaName, newName, newOwner),
  dropSchema: (connectionId: number, schemaName: string, cascade: boolean) =>
    ipcRenderer.invoke('schema:drop', connectionId, schemaName, cascade),
  getTableNames: (connectionId: number, schemaName: string) =>
    ipcRenderer.invoke('db:table-names', connectionId, schemaName),
  getColumnNames: (connectionId: number, schemaName: string, tableName: string) =>
    ipcRenderer.invoke('db:column-names', connectionId, schemaName, tableName),
  createTable: (connectionId: number, params: Record<string, unknown>) =>
    ipcRenderer.invoke('table:create', connectionId, params),
  alterTable: (connectionId: number, params: Record<string, unknown>) =>
    ipcRenderer.invoke('table:alter', connectionId, params),
  getObjectDDL: (connectionId: number, schemaName: string, objectName: string, objectType: string) =>
    ipcRenderer.invoke('db:object-ddl', connectionId, schemaName, objectName, objectType),
  selectAll: (connectionId: number, schemaName: string, tableName: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke('db:select-all', connectionId, schemaName, tableName, params),
  executeDataChanges: (connectionId: number, params: Record<string, unknown>) =>
    ipcRenderer.invoke('db:data-changes', connectionId, params),
  executeQuery: (connectionId: number, sql: string) =>
    ipcRenderer.invoke('db:execute-query', connectionId, sql),
  executeQueryBatch: (connectionId: number, sqls: string[], stopOnError: boolean, useTransaction: boolean) =>
    ipcRenderer.invoke('db:execute-query-batch', connectionId, sqls, stopOnError, useTransaction),
  cancelQuery: (connectionId: number) =>
    ipcRenderer.invoke('query:cancel', connectionId),
  getCompletionSchema: (connectionId: number, schemaName?: string) =>
    ipcRenderer.invoke('db:completion-schema', connectionId, schemaName),
  addQueryHistory: (params: Record<string, unknown>) =>
    ipcRenderer.invoke('history:add', params),
  getQueryHistory: (connectionId: number) =>
    ipcRenderer.invoke('history:list', connectionId),
  explainQuery: (connectionId: number, sql: string) =>
    ipcRenderer.invoke('query:explain', connectionId, sql),
  onMenuNewTab: (callback: () => void) =>
    ipcRenderer.on('menu:new-tab', () => callback()),
  onMenuCloseTab: (callback: () => void) =>
    ipcRenderer.on('menu:close-tab', () => callback()),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
