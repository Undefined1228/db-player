import { Client as PgClient } from 'pg'
import mysql from 'mysql2/promise'
import { getConnectionWithPassword, type ConnectionWithPassword } from './connection-repository'
import { openSshTunnel, type SshConfig } from './ssh-tunnel'

export async function getConnWithSsh(connectionId: number): Promise<ConnectionWithPassword> {
  const conn = getConnectionWithPassword(connectionId)
  if (!conn) throw new Error('연결 정보를 찾을 수 없습니다.')
  if (!conn.sshEnabled || !conn.sshHost || !conn.sshUsername) {
    return conn
  }
  const remoteHost = conn.host ?? '127.0.0.1'
  const remotePort = conn.port ?? (['mysql', 'mariadb'].includes(conn.dbType) ? 3306 : 5432)
  const sshConfig: SshConfig = {
    host: conn.sshHost,
    port: conn.sshPort ?? 22,
    username: conn.sshUsername,
    authMethod: conn.sshAuthMethod,
    password: conn.sshPassword || undefined,
    privateKey: conn.sshPrivateKey || undefined,
    passphrase: conn.sshPassphrase || undefined,
  }
  const { localPort } = await openSshTunnel(conn.id, sshConfig, remoteHost, remotePort)
  return { ...conn, host: '127.0.0.1', port: localPort }
}

export function buildPgConfig(conn: {
  host: string | null
  port: number | null
  databaseName: string | null
  username: string | null
  password: string
  url: string | null
  inputMode: string
}) {
  if (conn.inputMode === 'url' && conn.url) {
    const urlObj = new URL(conn.url.replace(/^jdbc:/i, ''))
    return {
      host: urlObj.hostname,
      port: Number(urlObj.port) || 5432,
      database: urlObj.pathname.slice(1) || undefined,
      user: conn.username ?? undefined,
      password: conn.password || undefined,
      connectionTimeoutMillis: 5000
    }
  }
  return {
    host: conn.host ?? undefined,
    port: conn.port ?? undefined,
    database: conn.databaseName ?? undefined,
    user: conn.username ?? undefined,
    password: conn.password || undefined,
    connectionTimeoutMillis: 5000
  }
}

export function buildMysqlConfig(conn: {
  host: string | null
  port: number | null
  databaseName: string | null
  username: string | null
  password: string
  url: string | null
  inputMode: string
}): mysql.ConnectionOptions {
  if (conn.inputMode === 'url' && conn.url) {
    const u = new URL(conn.url.replace(/^jdbc:/i, ''))
    return { host: u.hostname, port: Number(u.port) || 3306, database: u.pathname.slice(1) || undefined, user: conn.username ?? undefined, password: conn.password || undefined }
  }
  return { host: conn.host ?? undefined, port: conn.port ?? undefined, database: conn.databaseName ?? undefined, user: conn.username ?? undefined, password: conn.password || undefined }
}

export { PgClient, mysql }
