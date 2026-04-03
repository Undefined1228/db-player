import { ipcMain } from 'electron'
import {
  getSchemaObjects,
  getTableNames,
  getColumnNames,
  createTable,
  alterTable,
  getObjectDDL,
  createView,
  alterView,
  dropView,
  createIndex,
  dropIndex,
  type CreateIndexParams
} from '../db/metadata'
import type { CreateTableParams, AlterTableParams } from '../db/ddl-builder'

/**
 * 테이블, 뷰, 인덱스 관련 IPC 핸들러를 등록한다.
 * db:table-names, db:column-names, table:*, view:*, index:*, db:object-ddl, db:schema-objects 채널을 처리한다.
 */
export function register(): void {
  ipcMain.handle('db:table-names', async (_event, connectionId: number, schemaName: string) => {
    return getTableNames(connectionId, schemaName)
  })

  ipcMain.handle('db:column-names', async (_event, connectionId: number, schemaName: string, tableName: string) => {
    return getColumnNames(connectionId, schemaName, tableName)
  })

  ipcMain.handle('table:create', async (_event, connectionId: number, params: CreateTableParams) => {
    await createTable(connectionId, params)
    return { success: true }
  })

  ipcMain.handle('table:alter', async (_event, connectionId: number, params: AlterTableParams) => {
    await alterTable(connectionId, params)
    return { success: true }
  })

  ipcMain.handle('view:create', async (_event, connectionId: number, schemaName: string, viewName: string, selectQuery: string) => {
    await createView(connectionId, schemaName, viewName, selectQuery)
    return { success: true }
  })

  ipcMain.handle('view:alter', async (_event, connectionId: number, schemaName: string, viewName: string, newViewName: string | undefined, newSelectQuery: string | undefined) => {
    await alterView(connectionId, schemaName, viewName, newViewName, newSelectQuery)
    return { success: true }
  })

  ipcMain.handle('view:drop', async (_event, connectionId: number, schemaName: string, viewName: string, cascade: boolean) => {
    await dropView(connectionId, schemaName, viewName, cascade)
    return { success: true }
  })

  ipcMain.handle('index:create', async (_event, connectionId: number, params: CreateIndexParams) => {
    await createIndex(connectionId, params)
    return { success: true }
  })

  ipcMain.handle('index:drop', async (_event, connectionId: number, schemaName: string, indexName: string) => {
    await dropIndex(connectionId, schemaName, indexName)
    return { success: true }
  })

  ipcMain.handle('db:object-ddl', async (_event, connectionId: number, schemaName: string, objectName: string, objectType: string) => {
    return getObjectDDL(connectionId, schemaName, objectName, objectType as 'table' | 'view' | 'matview' | 'function')
  })

  ipcMain.handle('db:schema-objects', async (_event, connectionId: number, schemaName: string) => {
    return getSchemaObjects(connectionId, schemaName)
  })
}
