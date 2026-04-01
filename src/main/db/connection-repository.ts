import { getDb, encryptPassword, decryptPassword } from './app-db'

export interface ConnectionRecord {
  id: number
  name: string
  dbType: string
  inputMode: string
  host: string | null
  port: number | null
  databaseName: string | null
  username: string | null
  filePath: string | null
  url: string | null
  createdAt: string
  updatedAt: string
}

export interface ConnectionWithPassword extends ConnectionRecord {
  password: string
}

export interface SaveConnectionParams {
  id?: number
  name: string
  dbType: string
  inputMode: string
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  filePath?: string
  url?: string
}

export function saveConnection(params: SaveConnectionParams): ConnectionRecord {
  const db = getDb()
  const encrypted = encryptPassword(params.password ?? '')

  if (params.id) {
    db.prepare(`
      UPDATE connections SET
        name = ?, db_type = ?, input_mode = ?, host = ?, port = ?,
        database_name = ?, username = ?, password_encrypted = ?,
        file_path = ?, url = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      params.name, params.dbType, params.inputMode,
      params.host ?? null, params.port ?? null,
      params.database ?? null, params.username ?? null, encrypted,
      params.filePath ?? null, params.url ?? null,
      params.id
    )
    return getConnection(params.id)!
  }

  const result = db.prepare(`
    INSERT INTO connections (name, db_type, input_mode, host, port, database_name, username, password_encrypted, file_path, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.name, params.dbType, params.inputMode,
    params.host ?? null, params.port ?? null,
    params.database ?? null, params.username ?? null, encrypted,
    params.filePath ?? null, params.url ?? null
  )
  return getConnection(result.lastInsertRowid as number)!
}

export function getConnection(id: number): ConnectionRecord | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapRow(row)
}

export function getConnectionWithPassword(id: number): ConnectionWithPassword | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return undefined
  const record = mapRow(row)
  const password = decryptPassword(row.password_encrypted as Buffer)
  return { ...record, password }
}

export function listConnections(): ConnectionRecord[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM connections ORDER BY updated_at DESC').all() as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function deleteConnection(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM connections WHERE id = ?').run(id)
}

function mapRow(row: Record<string, unknown>): ConnectionRecord {
  return {
    id: row.id as number,
    name: row.name as string,
    dbType: row.db_type as string,
    inputMode: row.input_mode as string,
    host: row.host as string | null,
    port: row.port as number | null,
    databaseName: row.database_name as string | null,
    username: row.username as string | null,
    filePath: row.file_path as string | null,
    url: row.url as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}
