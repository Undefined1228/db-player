import mysql from 'mysql2/promise'
import { Client as PgClient } from 'pg'
import Database from 'better-sqlite3'

export interface ConnectionParams {
  dbType: 'mysql' | 'postgresql' | 'sqlite'
  inputMode: 'fields' | 'url'
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  filePath?: string
  url?: string
}

export async function testConnection(params: ConnectionParams): Promise<{ success: boolean; message: string }> {
  console.log('[main] testConnection 호출:', JSON.stringify(params))
  const start = Date.now()
  try {
    let result: { success: boolean; message: string }
    switch (params.dbType) {
      case 'mysql':
        result = await testMysql(params)
        break
      case 'postgresql':
        result = await testPostgresql(params)
        break
      case 'sqlite':
        result = testSqlite(params)
        break
      default:
        return { success: false, message: '지원하지 않는 DB 유형입니다.' }
    }
    const elapsed = Date.now() - start
    if (result.success) {
      result.message = `${result.message} (${elapsed}ms)`
    }
    console.log('[main] testConnection 결과:', JSON.stringify(result))
    return result
  } catch (err: unknown) {
    console.error('[main] testConnection 에러 원본:', err)
    const message = extractErrorMessage(err)
    return { success: false, message }
  }
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof AggregateError && err.errors?.length > 0) {
    return err.errors.map((e: Error) => e.message).join('; ')
  }
  if (err instanceof Error) {
    return err.message || err.toString()
  }
  return String(err) || '알 수 없는 오류가 발생했습니다.'
}

function stripJdbcPrefix(rawUrl: string): string {
  return rawUrl.replace(/^jdbc:/i, '')
}

function buildMysqlConfig(params: ConnectionParams): mysql.ConnectionOptions {
  if (params.inputMode === 'url') {
    const urlObj = new URL(stripJdbcPrefix(params.url!))
    return {
      host: urlObj.hostname,
      port: Number(urlObj.port) || 3306,
      database: urlObj.pathname.slice(1) || undefined,
      user: params.username || undefined,
      password: params.password || undefined,
      connectTimeout: 5000
    }
  }
  return {
    host: params.host,
    port: params.port,
    database: params.database || undefined,
    user: params.username || undefined,
    password: params.password || undefined,
    connectTimeout: 5000
  }
}

async function testMysql(params: ConnectionParams): Promise<{ success: boolean; message: string }> {
  let connection: mysql.Connection | undefined
  try {
    connection = await mysql.createConnection(buildMysqlConfig(params))
    const [rows] = await connection.query('SELECT VERSION() as version')
    const version = (rows as { version: string }[])[0]?.version ?? '알 수 없음'
    return { success: true, message: `연결 성공 — MySQL ${version}` }
  } finally {
    if (connection) await connection.end().catch(() => {})
  }
}

function buildPgConfig(params: ConnectionParams) {
  if (params.inputMode === 'url') {
    const urlObj = new URL(stripJdbcPrefix(params.url!))
    return {
      host: urlObj.hostname,
      port: Number(urlObj.port) || 5432,
      database: urlObj.pathname.slice(1) || undefined,
      user: params.username || undefined,
      password: params.password || undefined,
      connectionTimeoutMillis: 5000
    }
  }
  return {
    host: params.host,
    port: params.port,
    database: params.database || undefined,
    user: params.username || undefined,
    password: params.password || undefined,
    connectionTimeoutMillis: 5000
  }
}

async function testPostgresql(params: ConnectionParams): Promise<{ success: boolean; message: string }> {
  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(params))
    await client.connect()
    const result = await client.query('SELECT VERSION()')
    const versionFull = result.rows[0]?.version ?? ''
    const version = versionFull.split(',')[0] || '알 수 없음'
    return { success: true, message: `연결 성공 — ${version}` }
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

function testSqlite(params: ConnectionParams): { success: boolean; message: string } {
  let db: Database.Database | undefined
  try {
    db = new Database(params.filePath!, { readonly: true })
    const row = db.prepare('SELECT sqlite_version() as version').get() as { version: string } | undefined
    const version = row?.version ?? '알 수 없음'
    return { success: true, message: `연결 성공 — SQLite ${version}` }
  } finally {
    if (db) db.close()
  }
}
