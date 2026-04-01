import { writable } from 'svelte/store'

export interface Connection {
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
}

export const connections = writable<Connection[]>([])

export async function loadConnections(): Promise<void> {
  const list = await window.api.listConnections()
  connections.set(list)
}

export async function removeConnection(id: number): Promise<void> {
  await window.api.deleteConnection(id)
  await loadConnections()
}
