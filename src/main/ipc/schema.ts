import { ipcMain } from 'electron'
import {
  getSchemas,
  getRoles,
  createSchema,
  getSchemaOwner,
  alterSchema,
  dropSchema
} from '../db/metadata'

/**
 * 스키마 관련 IPC 핸들러를 등록한다.
 * db:schemas, db:roles, schema:* 채널을 처리한다.
 */
export function register(): void {
  ipcMain.handle('db:schemas', async (_event, connectionId: number) => {
    return getSchemas(connectionId)
  })

  ipcMain.handle('db:roles', async (_event, connectionId: number) => {
    return getRoles(connectionId)
  })

  ipcMain.handle('schema:create', async (_event, connectionId: number, schemaName: string, owner?: string) => {
    await createSchema(connectionId, schemaName, owner)
    return { success: true }
  })

  ipcMain.handle('schema:get-owner', async (_event, connectionId: number, schemaName: string) => {
    return getSchemaOwner(connectionId, schemaName)
  })

  ipcMain.handle('schema:alter', async (_event, connectionId: number, schemaName: string, newName?: string, newOwner?: string) => {
    await alterSchema(connectionId, schemaName, newName, newOwner)
    return { success: true }
  })

  ipcMain.handle('schema:drop', async (_event, connectionId: number, schemaName: string, cascade: boolean) => {
    await dropSchema(connectionId, schemaName, cascade)
    return { success: true }
  })
}
