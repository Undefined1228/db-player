import { writable } from 'svelte/store'

interface DDLDialogState {
  open: boolean
  title: string
  ddl: string
  loading: boolean
  error: string | null
}

export const ddlDialogStore = writable<DDLDialogState>({
  open: false,
  title: '',
  ddl: '',
  loading: false,
  error: null,
})
