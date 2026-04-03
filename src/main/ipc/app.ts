import { ipcMain, app, net, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

type WindowsUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloaded' | 'error'
  version: string | null
  message?: string
}

let windowsUpdateState: WindowsUpdateState = {
  status: 'idle',
  version: null
}

function setWindowsUpdateState(next: WindowsUpdateState): void {
  windowsUpdateState = next
}

function sendWindowsUpdateEvent(channel: 'update:available' | 'update:downloaded', version: string): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, version)
}

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

  ipcMain.handle('update:get-state', () => windowsUpdateState)

  if (process.platform === 'win32') {
    setWindowsUpdateState({ status: 'checking', version: null })

    autoUpdater.on('update-available', (info) => {
      setWindowsUpdateState({ status: 'available', version: info.version })
      sendWindowsUpdateEvent('update:available', info.version)
    })
    autoUpdater.on('update-downloaded', (info) => {
      setWindowsUpdateState({ status: 'downloaded', version: info.version })
      sendWindowsUpdateEvent('update:downloaded', info.version)
    })
    autoUpdater.on('error', (err) => {
      setWindowsUpdateState({
        status: 'error',
        version: null,
        message: err == null ? 'unknown error' : String(err)
      })
      log.error('업데이트 확인 실패:', err)
    })
    autoUpdater.checkForUpdates().catch((err) => {
      setWindowsUpdateState({
        status: 'error',
        version: null,
        message: err == null ? 'unknown error' : String(err)
      })
      log.error('업데이트 확인 실패:', err)
    })
  }
}
