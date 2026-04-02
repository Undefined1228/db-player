import * as connection from './connection'
import * as schema from './schema'
import * as table from './table'
import * as query from './query'
import * as data from './data'
import * as monitor from './monitor'
import * as appHandlers from './app'

/**
 * 모든 IPC 핸들러 모듈의 register() 함수를 호출하여 핸들러를 일괄 등록한다.
 */
export function registerAllHandlers(): void {
  connection.register()
  schema.register()
  table.register()
  query.register()
  data.register()
  monitor.register()
  appHandlers.register()
}
