import { ipcMain } from 'electron'
import { executeQuery, executeQueryBatch, cancelQuery, explainQuery } from '../db/metadata'
import { addQueryHistory, getQueryHistory } from '../db/app-db'

/**
 * 쿼리 실행 및 히스토리 관련 IPC 핸들러를 등록한다.
 * db:execute-query*, query:*, history:* 채널을 처리한다.
 */
export function register(): void {
  ipcMain.handle('db:execute-query', async (_event, connectionId: number, sql: string) => {
    return executeQuery(connectionId, sql)
  })

  ipcMain.handle('db:execute-query-batch', async (_event, connectionId: number, sqls: string[], stopOnError: boolean, useTransaction: boolean) => {
    return executeQueryBatch(connectionId, sqls, stopOnError, useTransaction)
  })

  ipcMain.handle('query:cancel', async (_event, connectionId: number) => {
    return cancelQuery(connectionId)
  })

  ipcMain.handle('query:explain', async (_event, connectionId: number, sql: string) => {
    return explainQuery(connectionId, sql)
  })

  ipcMain.handle('history:add', (_event, params: { connectionId: number; sql: string; executedAt: string; executionTime: number; success: boolean }) => {
    addQueryHistory(params)
    return { success: true }
  })

  ipcMain.handle('history:list', (_event, connectionId: number) => {
    return getQueryHistory(connectionId)
  })
}
