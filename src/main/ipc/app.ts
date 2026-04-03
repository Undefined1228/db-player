import { ipcMain, app, net, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

/**
 * 앱 전반 및 업데이트 관련 IPC 핸들러를 등록한다.
 * ping, app:*, shell:*, update:* 채널과 win32 autoUpdater 이벤트를 처리한다.
 */
export function register(): void {
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:check-update', async () => {
    if (process.platform !== 'darwin') return null
    try {
      const res = await net.fetch('https://api.github.com/repos/Undefined1228/db-player/releases/latest', {
        headers: { 'User-Agent': 'db-player-app' }
      })
      if (!res.ok) return null
      const data = await res.json() as { tag_name: string; html_url: string; assets: { name: string; browser_download_url: string }[] }
      const latestVersion = data.tag_name.replace(/^v/, '')
      const currentVersion = app.getVersion()
      const hasUpdate = latestVersion !== currentVersion
      const dmgAsset = data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.dmg'))
      return {
        hasUpdate,
        version: data.tag_name,
        downloadUrl: dmgAsset?.browser_download_url ?? data.html_url
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('shell:open-external', (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  if (process.platform === 'win32') {
    autoUpdater.on('update-available', (info) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('update:available', info.version)
    })
    autoUpdater.on('update-downloaded', (info) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('update:downloaded', info.version)
    })
    autoUpdater.checkForUpdates().catch((err) => log.error('업데이트 확인 실패:', err))
  }
}
