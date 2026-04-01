import { get } from 'svelte/store'
import { connections } from './connections'
import { tabsStore } from './tabs'
import { theme, type Theme } from './theme'

export interface Command {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

const staticCommands: Command[] = [
  {
    id: 'tab.new',
    label: '새 쿼리 탭 열기',
    shortcut: '⌘T',
    action: () => window.dispatchEvent(new CustomEvent('palette:new-tab')),
  },
  {
    id: 'query.run',
    label: '쿼리 실행',
    shortcut: '⌘↩',
    action: () => window.dispatchEvent(new CustomEvent('palette:run-query')),
  },
  {
    id: 'query.format',
    label: '쿼리 포맷',
    action: () => window.dispatchEvent(new CustomEvent('palette:format-query')),
  },
  {
    id: 'history.open',
    label: '히스토리 열기',
    action: () => window.dispatchEvent(new CustomEvent('palette:open-history')),
  },
  {
    id: 'theme.light',
    label: '테마 전환: 라이트',
    action: () => theme.set('light' as Theme),
  },
  {
    id: 'theme.dark',
    label: '테마 전환: 다크',
    action: () => theme.set('dark' as Theme),
  },
  {
    id: 'theme.system',
    label: '테마 전환: 시스템',
    action: () => theme.set('system' as Theme),
  },
]

export function getCommands(): Command[] {
  const conns = get(connections)
  const connectionCommands: Command[] = conns.map((conn) => ({
    id: `connection.switch.${conn.id}`,
    label: `연결 전환: ${conn.name}`,
    action: () => tabsStore.openTab({ connectionId: conn.id, dbType: conn.dbType }),
  }))
  return [...staticCommands, ...connectionCommands]
}

export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}
