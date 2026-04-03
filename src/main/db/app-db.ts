import { app, safeStorage } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import Database from 'better-sqlite3'

let db: Database.Database

export function initAppDb(): void {
  const dbPath = join(app.getPath('userData'), 'db-player.db')
  log.info('[app-db] better-sqlite3 로드 시도, dbPath:', dbPath)
  db = new Database(dbPath)
  log.info('[app-db] better-sqlite3 로드 완료')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      db_type TEXT NOT NULL,
      input_mode TEXT NOT NULL DEFAULT 'fields',
      host TEXT,
      port INTEGER,
      database_name TEXT,
      username TEXT,
      password_encrypted BLOB,
      file_path TEXT,
      url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS query_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      sql TEXT NOT NULL,
      executed_at TEXT NOT NULL,
      execution_time INTEGER NOT NULL,
      success INTEGER NOT NULL
    )
  `)

  const sshColumns: { name: string; ddl: string }[] = [
    { name: 'ssh_enabled', ddl: 'ALTER TABLE connections ADD COLUMN ssh_enabled INTEGER DEFAULT 0' },
    { name: 'ssh_host', ddl: 'ALTER TABLE connections ADD COLUMN ssh_host TEXT' },
    { name: 'ssh_port', ddl: 'ALTER TABLE connections ADD COLUMN ssh_port INTEGER' },
    { name: 'ssh_username', ddl: 'ALTER TABLE connections ADD COLUMN ssh_username TEXT' },
    { name: 'ssh_auth_method', ddl: "ALTER TABLE connections ADD COLUMN ssh_auth_method TEXT DEFAULT 'password'" },
    { name: 'ssh_password_encrypted', ddl: 'ALTER TABLE connections ADD COLUMN ssh_password_encrypted BLOB' },
    { name: 'ssh_private_key_encrypted', ddl: 'ALTER TABLE connections ADD COLUMN ssh_private_key_encrypted BLOB' },
    { name: 'ssh_passphrase_encrypted', ddl: 'ALTER TABLE connections ADD COLUMN ssh_passphrase_encrypted BLOB' },
  ]

  const existingColumns = (db.pragma('table_info(connections)') as { name: string }[]).map((c) => c.name)
  for (const col of sshColumns) {
    if (!existingColumns.includes(col.name)) {
      db.exec(col.ddl)
    }
  }
  log.info('[app-db] SSH 컬럼 마이그레이션 완료')
}

export function getDb(): Database.Database {
  return db
}

export function encryptPassword(plain: string): Buffer {
  if (!plain) return Buffer.alloc(0)
  return safeStorage.encryptString(plain)
}

export function decryptPassword(encrypted: Buffer): string {
  if (!encrypted || encrypted.length === 0) return ''
  return safeStorage.decryptString(encrypted)
}

export interface QueryHistoryRecord {
  id: number
  connectionId: number
  sql: string
  executedAt: string
  executionTime: number
  success: number
}

export function addQueryHistory(params: {
  connectionId: number
  sql: string
  executedAt: string
  executionTime: number
  success: boolean
}): void {
  db.prepare(
    `INSERT INTO query_history (connection_id, sql, executed_at, execution_time, success)
     VALUES (?, ?, ?, ?, ?)`
  ).run(params.connectionId, params.sql, params.executedAt, params.executionTime, params.success ? 1 : 0)

  db.prepare(
    `DELETE FROM query_history
     WHERE connection_id = ? AND id NOT IN (
       SELECT id FROM query_history
       WHERE connection_id = ?
       ORDER BY executed_at DESC
       LIMIT 100
     )`
  ).run(params.connectionId, params.connectionId)
}

export function getQueryHistory(connectionId: number): QueryHistoryRecord[] {
  return db.prepare(
    `SELECT id, connection_id AS connectionId, sql, executed_at AS executedAt,
            execution_time AS executionTime, success
     FROM query_history
     WHERE connection_id = ?
     ORDER BY executed_at DESC
     LIMIT 100`
  ).all(connectionId) as QueryHistoryRecord[]
}
