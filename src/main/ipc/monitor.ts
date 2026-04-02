import { ipcMain } from 'electron'
import { getSessions, killSession, getLocks, getTableStats } from '../db/metadata'

/**
 * 모니터링 관련 IPC 핸들러를 등록한다.
 * monitor:* 채널을 처리한다.
 */
export function register(): void {
  ipcMain.handle('monitor:sessions', (_event, connectionId: number) => {
    return getSessions(connectionId)
  })

  ipcMain.handle('monitor:kill-session', (_event, connectionId: number, sessionId: number, mode: 'cancel' | 'terminate') => {
    return killSession(connectionId, sessionId, mode)
  })

  ipcMain.handle('monitor:locks', (_event, connectionId: number) => {
    return getLocks(connectionId)
  })

  ipcMain.handle('monitor:table-stats', (_event, connectionId: number) => {
    return getTableStats(connectionId)
  })
}
