import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log'

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
import icon from '../../resources/icon.png?asset'
import { testConnection, type ConnectionParams } from './db/test-connection'
import { initAppDb, addQueryHistory, getQueryHistory } from './db/app-db'
import {
  saveConnection,
  listConnections,
  deleteConnection,
  getConnectionWithPassword,
  type SaveConnectionParams
} from './db/connection-repository'
import { getSchemas, getSchemaObjects, getCompletionSchema, getRoles, createSchema, getSchemaOwner, alterSchema, dropSchema, createTable, alterTable, getTableNames, getColumnNames, getObjectDDL, selectAll, executeDataChanges, executeQuery, executeQueryBatch, cancelQuery, explainQuery, type DataChangesParams, type SelectAllParams } from './db/metadata'
import type { CreateTableParams, AlterTableParams } from './db/ddl-builder'

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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
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

  ipcMain.on('ping', () => console.log('pong'))

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

  ipcMain.handle('db:object-ddl', async (_event, connectionId: number, schemaName: string, objectName: string, objectType: string) => {
    return getObjectDDL(connectionId, schemaName, objectName, objectType as 'table' | 'view' | 'matview' | 'function')
  })

  ipcMain.handle('db:schema-objects', async (_event, connectionId: number, schemaName: string) => {
    return getSchemaObjects(connectionId, schemaName)
  })

  ipcMain.handle('db:completion-schema', async (_event, connectionId: number, schemaName?: string) => {
    return getCompletionSchema(connectionId, schemaName)
  })

  ipcMain.handle('db:select-all', async (_event, connectionId: number, schemaName: string, tableName: string, params: SelectAllParams) => {
    return selectAll(connectionId, schemaName, tableName, params)
  })

  ipcMain.handle('db:data-changes', async (_event, connectionId: number, params: DataChangesParams) => {
    await executeDataChanges(connectionId, params)
    return { success: true }
  })

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

  log.info('createWindow 호출')
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
