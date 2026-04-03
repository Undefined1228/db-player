import { writable, get } from 'svelte/store'
import { connections } from './connections'

export interface EditorTab {
  id: string
  connectionId: number
  dbType: string
  schemaName?: string
  title: string
  query: string
  type: 'editor' | 'data' | 'erd' | 'monitor'
  objectName?: string
  objectType?: 'table' | 'view' | 'matview' | 'function'
}

interface TabsState {
  tabs: EditorTab[]
  activeId: string | null
}

function createTabsStore() {
  const { subscribe, update } = writable<TabsState>({ tabs: [], activeId: null })

  function openTab(params: { connectionId: number; dbType: string; schemaName?: string; title?: string; type?: 'editor' | 'data' | 'erd' | 'monitor'; objectName?: string; objectType?: 'table' | 'view' | 'matview' | 'function' }): void {
    const id = crypto.randomUUID()
    const conn = get(connections).find((c) => c.id === params.connectionId)
    const title =
      params.title ??
      params.schemaName ??
      conn?.name ??
      `연결 ${params.connectionId}`

    const tab: EditorTab = {
      id,
      connectionId: params.connectionId,
      dbType: params.dbType,
      schemaName: params.schemaName,
      title,
      query: '',
      type: params.type ?? 'editor',
      objectName: params.objectName,
      objectType: params.objectType,
    }
    update((s) => ({ tabs: [...s.tabs, tab], activeId: id }))
  }

  function closeTab(id: string): void {
    update((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeId = s.activeId
      if (activeId === id) {
        activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
      }
      return { tabs, activeId }
    })
  }

  function setActiveTab(id: string): void {
    update((s) => ({ ...s, activeId: id }))
  }

  function updateQuery(id: string, query: string): void {
    update((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, query } : t)),
    }))
  }

  return { subscribe, openTab, closeTab, setActiveTab, updateQuery }
}

export const tabsStore = createTabsStore()
