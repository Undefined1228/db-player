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
  sshEnabled: boolean
  sshHost: string | null
  sshPort: number | null
  sshUsername: string | null
  sshAuthMethod: 'password' | 'key'
}

export interface ConnectionWithPassword extends ConnectionRecord {
  password: string
  sshPassword: string
  sshPrivateKey: string
  sshPassphrase: string
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
  sshEnabled?: boolean
  sshHost?: string
  sshPort?: number
  sshUsername?: string
  sshAuthMethod?: 'password' | 'key'
  sshPassword?: string
  sshPrivateKey?: string
  sshPassphrase?: string
}

export function saveConnection(params: SaveConnectionParams): ConnectionRecord {
  const db = getDb()
  const encrypted = encryptPassword(params.password ?? '')
  const sshPasswordEncrypted = encryptPassword(params.sshPassword ?? '')
  const sshPrivateKeyEncrypted = encryptPassword(params.sshPrivateKey ?? '')
  const sshPassphraseEncrypted = encryptPassword(params.sshPassphrase ?? '')

  if (params.id) {
    db.prepare(`
      UPDATE connections SET
        name = ?, db_type = ?, input_mode = ?, host = ?, port = ?,
        database_name = ?, username = ?, password_encrypted = ?,
        file_path = ?, url = ?,
        ssh_enabled = ?, ssh_host = ?, ssh_port = ?, ssh_username = ?,
        ssh_auth_method = ?, ssh_password_encrypted = ?,
        ssh_private_key_encrypted = ?, ssh_passphrase_encrypted = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      params.name, params.dbType, params.inputMode,
      params.host ?? null, params.port ?? null,
      params.database ?? null, params.username ?? null, encrypted,
      params.filePath ?? null, params.url ?? null,
      params.sshEnabled ? 1 : 0,
      params.sshHost ?? null, params.sshPort ?? null, params.sshUsername ?? null,
      params.sshAuthMethod ?? 'password',
      sshPasswordEncrypted, sshPrivateKeyEncrypted, sshPassphraseEncrypted,
      params.id
    )
    return getConnection(params.id)!
  }

  const result = db.prepare(`
    INSERT INTO connections (
      name, db_type, input_mode, host, port, database_name, username, password_encrypted,
      file_path, url,
      ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_method,
      ssh_password_encrypted, ssh_private_key_encrypted, ssh_passphrase_encrypted
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.name, params.dbType, params.inputMode,
    params.host ?? null, params.port ?? null,
    params.database ?? null, params.username ?? null, encrypted,
    params.filePath ?? null, params.url ?? null,
    params.sshEnabled ? 1 : 0,
    params.sshHost ?? null, params.sshPort ?? null, params.sshUsername ?? null,
    params.sshAuthMethod ?? 'password',
    sshPasswordEncrypted, sshPrivateKeyEncrypted, sshPassphraseEncrypted
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
  const sshPassword = decryptPassword(row.ssh_password_encrypted as Buffer)
  const sshPrivateKey = decryptPassword(row.ssh_private_key_encrypted as Buffer)
  const sshPassphrase = decryptPassword(row.ssh_passphrase_encrypted as Buffer)
  return { ...record, password, sshPassword, sshPrivateKey, sshPassphrase }
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
    updatedAt: row.updated_at as string,
    sshEnabled: (row.ssh_enabled as number) === 1,
    sshHost: row.ssh_host as string | null,
    sshPort: row.ssh_port as number | null,
    sshUsername: row.ssh_username as string | null,
    sshAuthMethod: (row.ssh_auth_method as 'password' | 'key') ?? 'password',
  }
}
