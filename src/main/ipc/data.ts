import { ipcMain } from 'electron'
import {
  selectAll,
  executeDataChanges,
  getCompletionSchema,
  type DataChangesParams,
  type SelectAllParams
} from '../db/metadata'

/**
 * 데이터 조회 및 변경, 자동완성 스키마 관련 IPC 핸들러를 등록한다.
 * db:select-all, db:data-changes, db:completion-schema 채널을 처리한다.
 */
export function register(): void {
  ipcMain.handle('db:select-all', async (_event, connectionId: number, schemaName: string, tableName: string, params: SelectAllParams) => {
    return selectAll(connectionId, schemaName, tableName, params)
  })

  ipcMain.handle('db:data-changes', async (_event, connectionId: number, params: DataChangesParams) => {
    await executeDataChanges(connectionId, params)
    return { success: true }
  })

  ipcMain.handle('db:completion-schema', async (_event, connectionId: number, schemaName?: string) => {
    return getCompletionSchema(connectionId, schemaName)
  })
}
