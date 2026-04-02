import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log'
import icon from '../../resources/icon.png?asset'
import { initAppDb } from './db/app-db'
import { closeAllSshTunnels } from './db/ssh-tunnel'
import { registerAllHandlers } from './ipc'

log.transports.file.level = 'debug'
log.transports.console.level = 'debug'
log.info('=== db-player 시작 ===')
log.info('플랫폼:', process.platform, '아키텍처:', process.arch)
log.info('Electron:', process.versions.electron, 'Node:', process.versions.node)
log.info('로그 파일 위치:', log.transports.file.getFile().path)

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')

process.on('uncaughtException', (err) => {
  log.error('uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection:', reason)
})

function createWindow(): void {
  log.info('BrowserWindow 생성 중')
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    title: 'DB Player',
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    log.info('윈도우 ready-to-show')
    mainWindow.show()
  })

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
    log.error('페이지 로드 실패:', errorCode, errorDesc)
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('렌더러 프로세스 종료:', details)
  })

  mainWindow.webContents.on('crashed' as Parameters<typeof mainWindow.webContents.on>[0], (_e: unknown, killed: unknown) => {
    log.error('렌더러 크래시, killed:', killed)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if ((input.meta || input.control) && input.key === 'r') {
      _event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.setName('DB Player')

app.whenReady().then(() => {
  log.info('app.whenReady')
  electronApp.setAppUserModelId('com.dbplayer')

  try {
    initAppDb()
    log.info('initAppDb 완료')
  } catch (err) {
    log.error('initAppDb 실패:', err)
  }

  const isMac = process.platform === 'darwin'
  const appName = 'DB Player'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: appName,
      submenu: [
        { role: 'about' as const, label: `${appName} 정보` },
        { type: 'separator' as const },
        { role: 'services' as const, label: '서비스' },
        { type: 'separator' as const },
        { role: 'hide' as const, label: `${appName} 숨기기` },
        { role: 'hideOthers' as const, label: '다른 앱 숨기기' },
        { role: 'unhide' as const, label: '모두 보기' },
        { type: 'separator' as const },
        { role: 'quit' as const, label: `${appName} 종료` },
      ]
    }] : []),
    {
      label: '파일',
      submenu: [
        {
          label: '새 쿼리 탭',
          accelerator: 'CommandOrControl+T',
          click: () => { BrowserWindow.getFocusedWindow()?.webContents.send('menu:new-tab') }
        },
        {
          label: '탭 닫기',
          accelerator: 'CommandOrControl+W',
          click: () => { BrowserWindow.getFocusedWindow()?.webContents.send('menu:close-tab') }
        },
      ]
    },
    {
      label: '보기',
      submenu: [
        { role: 'toggleDevTools' as const, label: '개발자 도구' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '전체 화면' },
      ]
    },
    {
      label: '윈도우',
      submenu: [
        { role: 'minimize' as const, label: '최소화' },
        ...(isMac ? [{ role: 'front' as const, label: '맨 앞으로' }] : []),
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerAllHandlers()

  log.info('createWindow 호출')
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', closeAllSshTunnels)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
