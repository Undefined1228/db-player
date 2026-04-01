import { writable } from 'svelte/store'

export type Theme = 'system' | 'light' | 'dark'

const stored = localStorage.getItem('theme') as Theme | null
export const theme = writable<Theme>(stored ?? 'system')

function applyTheme(value: Theme): void {
  const root = document.documentElement
  if (value === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  } else {
    root.classList.toggle('dark', value === 'dark')
  }
}

theme.subscribe((value) => {
  console.log('[theme store] subscribe 호출:', value)
  localStorage.setItem('theme', value)
  applyTheme(value)
  console.log('[theme store] 적용 완료, dark class:', document.documentElement.classList.contains('dark'))
})

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = localStorage.getItem('theme') as Theme
  if (current === 'system') applyTheme('system')
})
