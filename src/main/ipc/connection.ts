import { ipcMain } from 'electron'
import { testConnection, type ConnectionParams } from '../db/test-connection'
import { closeSshTunnel } from '../db/ssh-tunnel'
import {
  saveConnection,
  listConnections,
  deleteConnection,
  getConnectionWithPassword,
  type SaveConnectionParams
} from '../db/connection-repository'

/**
 * 연결 관련 IPC 핸들러를 등록한다.
 * conn:*, db:test-connection, ssh:close-tunnel 채널을 처리한다.
 */
export function register(): void {
  ipcMain.handle('conn:save', (_event, params: SaveConnectionParams) => {
    return saveConnection(params)
  })

  ipcMain.handle('conn:list', () => {
    return listConnections()
  })

  ipcMain.handle('conn:delete', (_event, id: number) => {
    deleteConnection(id)
    return { success: true }
  })

  ipcMain.handle('conn:get', (_event, id: number) => {
    return getConnectionWithPassword(id) ?? null
  })

  ipcMain.handle('db:test-connection', async (_event, params: ConnectionParams) => {
    console.log('[main ipc] db:test-connection 수신:', JSON.stringify(params))
    try {
      const result = await testConnection(params)
      console.log('[main ipc] db:test-connection 응답:', JSON.stringify(result))
      return result
    } catch (err) {
      console.error('[main ipc] db:test-connection 예외:', err)
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('ssh:close-tunnel', (_event, connectionId: number) => {
    closeSshTunnel(connectionId)
  })
}
