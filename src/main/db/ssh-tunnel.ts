import { Client } from 'ssh2'
import * as net from 'net'
import log from 'electron-log'

export interface SshConfig {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key'
  password?: string
  privateKey?: string
  passphrase?: string
}

interface TunnelEntry {
  client: Client
  server: net.Server
  localPort: number
}

const tunnelMap = new Map<number, TunnelEntry>()

/**
 * connectionId별 SSH 터널을 열고 로컬 포트를 반환한다.
 * 이미 열린 터널이 있으면 기존 포트를 재사용한다.
 */
export function openSshTunnel(
  connectionId: number,
  sshConfig: SshConfig,
  remoteHost: string,
  remotePort: number
): Promise<{ localPort: number }> {
  const existing = tunnelMap.get(connectionId)
  if (existing) {
    return Promise.resolve({ localPort: existing.localPort })
  }

  return new Promise((resolve, reject) => {
    const conn = new Client()

    const server = net.createServer((sock) => {
      conn.forwardOut('127.0.0.1', (server.address() as net.AddressInfo).port, remoteHost, remotePort, (err, stream) => {
        if (err) {
          sock.destroy()
          return
        }
        sock.pipe(stream).pipe(sock)
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const localPort = (server.address() as net.AddressInfo).port

      const connectConfig: Parameters<Client['connect']>[0] = {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        readyTimeout: 10000
      }

      if (sshConfig.authMethod === 'key') {
        connectConfig.privateKey = sshConfig.privateKey
        if (sshConfig.passphrase) {
          connectConfig.passphrase = sshConfig.passphrase
        }
      } else {
        connectConfig.password = sshConfig.password
      }

      conn.on('ready', () => {
        log.info(`[ssh-tunnel] 터널 개통 connectionId=${connectionId} localPort=${localPort} -> ${remoteHost}:${remotePort}`)
        tunnelMap.set(connectionId, { client: conn, server, localPort })
        resolve({ localPort })
      })

      conn.on('error', (err) => {
        server.close()
        log.error(`[ssh-tunnel] SSH 연결 오류 connectionId=${connectionId}:`, err.message)
        reject(new Error(`SSH 연결 실패: ${err.message}`))
      })

      conn.connect(connectConfig)
    })

    server.on('error', (err) => {
      conn.end()
      log.error(`[ssh-tunnel] 로컬 서버 오류 connectionId=${connectionId}:`, err.message)
      reject(new Error(`SSH 터널 로컬 서버 오류: ${err.message}`))
    })
  })
}

/**
 * 특정 connectionId의 SSH 터널을 닫는다.
 */
export function closeSshTunnel(connectionId: number): void {
  const entry = tunnelMap.get(connectionId)
  if (!entry) return
  entry.server.close()
  entry.client.end()
  tunnelMap.delete(connectionId)
  log.info(`[ssh-tunnel] 터널 종료 connectionId=${connectionId}`)
}

/**
 * 앱 종료 시 모든 SSH 터널을 닫는다.
 */
export function closeAllSshTunnels(): void {
  for (const [connectionId] of tunnelMap) {
    closeSshTunnel(connectionId)
  }
  log.info('[ssh-tunnel] 전체 터널 종료')
}
