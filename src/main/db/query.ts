import Database from 'better-sqlite3'
import { getConnectionWithPassword } from './connection-repository'
import { getConnWithSsh, buildPgConfig, buildMysqlConfig, PgClient, mysql } from './connection-utils'

export type QueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; affectedRows: number | null; columnTypes: Record<string, string> }
  | { ok: false; message: string; position?: number }

export type BatchQueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; affectedRows: number | null; executionTime: number; columnTypes: Record<string, string> }
  | { ok: false; message: string; position?: number; executionTime: number; skipped?: true }

export type BatchQueryResponse = {
  results: BatchQueryResult[]
  transactionResult?: 'committed' | 'rolledback'
}

export const runningQueryMap = new Map<number, { dbType: string; pgPid?: number; mysqlConnId?: number }>()

function pgOidToCategory(oid: number): string {
  if ([16].includes(oid)) return 'boolean'
  if ([20, 21, 23, 26, 700, 701, 790, 1700].includes(oid)) return 'numeric'
  if ([1082, 1083, 1114, 1184, 1186].includes(oid)) return 'datetime'
  return 'string'
}

function mysqlTypeToCategory(type: number): string {
  if ([0, 1, 2, 3, 4, 5, 8, 9, 13, 16, 246].includes(type)) return 'numeric'
  if ([7, 10, 11, 12, 14].includes(type)) return 'datetime'
  return 'string'
}

function sqliteTypeToCategory(type: string | null): string {
  if (!type) return 'string'
  const t = type.toUpperCase()
  if (/\bBOOL/.test(t)) return 'boolean'
  if (/INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/.test(t)) return 'numeric'
  if (/DATE|TIME/.test(t)) return 'datetime'
  return 'string'
}

export async function executeQuery(connectionId: number, sql: string): Promise<QueryResult> {
  const conn = getConnectionWithPassword(connectionId)
  if (!conn) return { ok: false, message: '연결 정보를 찾을 수 없습니다.' }

  switch (conn.dbType) {
    case 'postgresql': {
      let client: InstanceType<typeof PgClient> | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        runningQueryMap.set(connectionId, { dbType: 'postgresql', pgPid: (client as unknown as { processID?: number }).processID ?? undefined })
        const result = await client.query(sql)
        const columns = result.fields ? result.fields.map((f) => f.name) : []
        const columnTypes: Record<string, string> = {}
        if (result.fields) {
          for (const f of result.fields) columnTypes[f.name] = pgOidToCategory(f.dataTypeID)
        }
        return { ok: true, columns, rows: result.rows ?? [], affectedRows: result.rowCount ?? null, columnTypes }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const position = (err as { position?: string }).position ? Number((err as { position?: string }).position) : undefined
        return { ok: false, message, position }
      } finally {
        runningQueryMap.delete(connectionId)
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        runningQueryMap.set(connectionId, { dbType: conn.dbType, mysqlConnId: connection.threadId ?? undefined })
        const [rowsOrOk, fields] = await connection.query(sql)
        if (Array.isArray(rowsOrOk) && fields) {
          const columns = (fields as mysql.FieldPacket[]).map((f) => f.name)
          const columnTypes: Record<string, string> = {}
          for (const f of fields as mysql.FieldPacket[]) columnTypes[f.name] = mysqlTypeToCategory((f as unknown as { type: number }).type ?? 0)
          return { ok: true, columns, rows: rowsOrOk as Record<string, unknown>[], affectedRows: null, columnTypes }
        }
        const ok = rowsOrOk as mysql.ResultSetHeader
        return { ok: true, columns: [], rows: [], affectedRows: ok.affectedRows ?? null, columnTypes: {} }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      } finally {
        runningQueryMap.delete(connectionId)
        if (connection) await connection.end().catch(() => {})
      }
    }
    case 'sqlite': {
      const filePath = conn.filePath
      if (!filePath) return { ok: false, message: 'SQLite 파일 경로가 없습니다.' }
      const db = new Database(filePath)
      try {
        const stmt = db.prepare(sql)
        if (stmt.reader) {
          const columnInfos = stmt.columns()
          const rows = stmt.all() as Record<string, unknown>[]
          const columns = columnInfos.map((c) => c.name)
          const columnTypes: Record<string, string> = {}
          for (const c of columnInfos) columnTypes[c.name] = sqliteTypeToCategory(c.type)
          return { ok: true, columns, rows, affectedRows: null, columnTypes }
        } else {
          const info = stmt.run()
          return { ok: true, columns: [], rows: [], affectedRows: info.changes, columnTypes: {} }
        }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      } finally {
        db.close()
      }
    }
    default:
      return { ok: false, message: '지원하지 않는 DB 유형입니다.' }
  }
}

export async function executeQueryBatch(
  connectionId: number,
  sqls: string[],
  stopOnError: boolean,
  useTransaction: boolean = false
): Promise<BatchQueryResponse> {
  const conn = getConnectionWithPassword(connectionId)
  if (!conn) {
    return { results: sqls.map(() => ({ ok: false as const, message: '연결 정보를 찾을 수 없습니다.', executionTime: 0 })) }
  }

  const results: BatchQueryResult[] = []
  let transactionResult: 'committed' | 'rolledback' | undefined

  switch (conn.dbType) {
    case 'postgresql': {
      const client = new PgClient(buildPgConfig(conn))
      let errorOccurred = false
      try {
        await client.connect()
        runningQueryMap.set(connectionId, { dbType: 'postgresql', pgPid: (client as unknown as { processID?: number }).processID ?? undefined })
        if (useTransaction) await client.query('BEGIN')
        for (let i = 0; i < sqls.length; i++) {
          const sql = sqls[i]
          const start = Date.now()
          try {
            const result = await client.query(sql)
            const executionTime = Date.now() - start
            const columns = result.fields ? result.fields.map((f) => f.name) : []
            const columnTypes: Record<string, string> = {}
            if (result.fields) {
              for (const f of result.fields) columnTypes[f.name] = pgOidToCategory(f.dataTypeID)
            }
            results.push({ ok: true, columns, rows: result.rows ?? [], affectedRows: result.rowCount ?? null, executionTime, columnTypes })
          } catch (err) {
            const executionTime = Date.now() - start
            const message = err instanceof Error ? err.message : String(err)
            const position = (err as { position?: string }).position ? Number((err as { position?: string }).position) : undefined
            results.push({ ok: false, message, position, executionTime })
            errorOccurred = true
            if (stopOnError) {
              for (let j = i + 1; j < sqls.length; j++) {
                results.push({ ok: false, message: '이전 쿼리 실패로 인해 실행되지 않았습니다.', executionTime: 0, skipped: true })
              }
              break
            }
          }
        }
        if (useTransaction) {
          if (errorOccurred) {
            await client.query('ROLLBACK').catch(() => {})
            transactionResult = 'rolledback'
          } else {
            await client.query('COMMIT')
            transactionResult = 'committed'
          }
        }
      } finally {
        runningQueryMap.delete(connectionId)
        await client.end().catch(() => {})
      }
      break
    }
    case 'mariadb':
    case 'mysql': {
      const connection = await mysql.createConnection(buildMysqlConfig(conn))
      let errorOccurred = false
      try {
        runningQueryMap.set(connectionId, { dbType: conn.dbType, mysqlConnId: connection.threadId ?? undefined })
        if (useTransaction) await connection.beginTransaction()
        for (let i = 0; i < sqls.length; i++) {
          const sql = sqls[i]
          const start = Date.now()
          try {
            const [rowsOrOk, fields] = await connection.query(sql)
            const executionTime = Date.now() - start
            if (Array.isArray(rowsOrOk) && fields) {
              const columns = (fields as mysql.FieldPacket[]).map((f) => f.name)
              const columnTypes: Record<string, string> = {}
              for (const f of fields as mysql.FieldPacket[]) columnTypes[f.name] = mysqlTypeToCategory((f as unknown as { type: number }).type ?? 0)
              results.push({ ok: true, columns, rows: rowsOrOk as Record<string, unknown>[], affectedRows: null, executionTime, columnTypes })
            } else {
              const ok = rowsOrOk as mysql.ResultSetHeader
              results.push({ ok: true, columns: [], rows: [], affectedRows: ok.affectedRows ?? null, executionTime, columnTypes: {} })
            }
          } catch (err) {
            const executionTime = Date.now() - start
            results.push({ ok: false, message: err instanceof Error ? err.message : String(err), executionTime })
            errorOccurred = true
            if (stopOnError) {
              for (let j = i + 1; j < sqls.length; j++) {
                results.push({ ok: false, message: '이전 쿼리 실패로 인해 실행되지 않았습니다.', executionTime: 0, skipped: true })
              }
              break
            }
          }
        }
        if (useTransaction) {
          if (errorOccurred) {
            await connection.rollback()
            transactionResult = 'rolledback'
          } else {
            await connection.commit()
            transactionResult = 'committed'
          }
        }
      } finally {
        runningQueryMap.delete(connectionId)
        await connection.end().catch(() => {})
      }
      break
    }
    case 'sqlite': {
      const filePath = conn.filePath
      if (!filePath) {
        return { results: sqls.map(() => ({ ok: false as const, message: 'SQLite 파일 경로가 없습니다.', executionTime: 0 })) }
      }
      const db = new Database(filePath)
      let errorOccurred = false
      try {
        if (useTransaction) db.exec('BEGIN')
        for (let i = 0; i < sqls.length; i++) {
          const sql = sqls[i]
          const start = Date.now()
          try {
            const stmt = db.prepare(sql)
            const executionTime = Date.now() - start
            if (stmt.reader) {
              const columnInfos = stmt.columns()
              const rows = stmt.all() as Record<string, unknown>[]
              const columns = columnInfos.map((c) => c.name)
              const columnTypes: Record<string, string> = {}
              for (const c of columnInfos) columnTypes[c.name] = sqliteTypeToCategory(c.type)
              results.push({ ok: true, columns, rows, affectedRows: null, executionTime, columnTypes })
            } else {
              const info = stmt.run()
              results.push({ ok: true, columns: [], rows: [], affectedRows: info.changes, executionTime, columnTypes: {} })
            }
          } catch (err) {
            const executionTime = Date.now() - start
            results.push({ ok: false, message: err instanceof Error ? err.message : String(err), executionTime })
            errorOccurred = true
            if (stopOnError) {
              for (let j = i + 1; j < sqls.length; j++) {
                results.push({ ok: false, message: '이전 쿼리 실패로 인해 실행되지 않았습니다.', executionTime: 0, skipped: true })
              }
              break
            }
          }
        }
        if (useTransaction) {
          if (errorOccurred) {
            db.exec('ROLLBACK')
            transactionResult = 'rolledback'
          } else {
            db.exec('COMMIT')
            transactionResult = 'committed'
          }
        }
      } finally {
        db.close()
      }
      break
    }
    default:
      return { results: sqls.map(() => ({ ok: false as const, message: '지원하지 않는 DB 유형입니다.', executionTime: 0 })) }
  }

  return { results, transactionResult }
}

export async function cancelQuery(connectionId: number): Promise<{ ok: boolean }> {
  const info = runningQueryMap.get(connectionId)
  if (!info) return { ok: false }
  let conn
  try {
    conn = await getConnWithSsh(connectionId)
  } catch {
    return { ok: false }
  }

  if (info.dbType === 'postgresql' && info.pgPid !== undefined) {
    const cancelClient = new PgClient(buildPgConfig(conn))
    try {
      await cancelClient.connect()
      await cancelClient.query('SELECT pg_cancel_backend($1)', [info.pgPid])
    } finally {
      await cancelClient.end().catch(() => {})
    }
  } else if ((info.dbType === 'mysql' || info.dbType === 'mariadb') && info.mysqlConnId !== undefined) {
    const cancelConn = await mysql.createConnection(buildMysqlConfig(conn))
    try {
      await cancelConn.query('KILL QUERY ?', [info.mysqlConnId])
    } finally {
      await cancelConn.end().catch(() => {})
    }
  }
  return { ok: true }
}

export async function getCompletionSchema(
  connectionId: number,
  schemaName?: string
): Promise<Record<string, string[]>> {
  const conn = await getConnWithSsh(connectionId)

  switch (conn.dbType) {
    case 'postgresql': {
      let client: InstanceType<typeof PgClient> | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        const tablesResult = schemaName
          ? await client.query(
              `SELECT t.table_schema, t.table_name, c.column_name
               FROM information_schema.tables t
               JOIN information_schema.columns c
                 ON c.table_schema = t.table_schema AND c.table_name = t.table_name
               WHERE t.table_schema = $1 AND t.table_type IN ('BASE TABLE', 'VIEW')
               ORDER BY t.table_name, c.ordinal_position`,
              [schemaName]
            )
          : await client.query(
              `SELECT t.table_schema, t.table_name, c.column_name
               FROM information_schema.tables t
               JOIN information_schema.columns c
                 ON c.table_schema = t.table_schema AND c.table_name = t.table_name
               WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                 AND t.table_type IN ('BASE TABLE', 'VIEW')
               ORDER BY t.table_schema, t.table_name, c.ordinal_position`
            )
        const result: Record<string, string[]> = {}
        for (const row of tablesResult.rows) {
          const schema = row.table_schema as string
          const tbl = row.table_name as string
          const qualified = `${schema}.${tbl}`
          if (!result[tbl]) result[tbl] = []
          result[tbl].push(row.column_name as string)
          if (!result[qualified]) result[qualified] = []
          result[qualified].push(row.column_name as string)
        }
        return result
      } finally {
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      const database = schemaName ?? conn.databaseName
      if (!database) return {}
      let connection: mysql.Connection | undefined
      try {
        const cfg: mysql.ConnectionOptions =
          conn.inputMode === 'url' && conn.url
            ? (() => {
                const u = new URL(conn.url.replace(/^jdbc:/i, ''))
                return {
                  host: u.hostname,
                  port: Number(u.port) || 3306,
                  database: u.pathname.slice(1) || undefined,
                  user: conn.username ?? undefined,
                  password: conn.password || undefined
                }
              })()
            : {
                host: conn.host ?? undefined,
                port: conn.port ?? undefined,
                database,
                user: conn.username ?? undefined,
                password: conn.password || undefined
              }
        connection = await mysql.createConnection(cfg)
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT t.TABLE_NAME, c.COLUMN_NAME
           FROM information_schema.TABLES t
           JOIN information_schema.COLUMNS c
             ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
           WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
           ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`,
          [database]
        )
        const result: Record<string, string[]> = {}
        for (const row of rows) {
          const tbl = row.TABLE_NAME as string
          if (!result[tbl]) result[tbl] = []
          result[tbl].push(row.COLUMN_NAME as string)
        }
        return result
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    case 'sqlite': {
      const filePath = conn.filePath
      if (!filePath) return {}
      const db = new Database(filePath, { readonly: true })
      try {
        const tables = db
          .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name`)
          .all() as { name: string }[]
        const result: Record<string, string[]> = {}
        for (const { name } of tables) {
          const cols = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as { name: string }[]
          result[name] = cols.map((c) => c.name)
        }
        return result
      } finally {
        db.close()
      }
    }
    default:
      return {}
  }
}
