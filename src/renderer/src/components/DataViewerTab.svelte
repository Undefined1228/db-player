<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { Plus, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUp, ArrowDown, ArrowUpDown, Save, X, Download, ChevronDown, Clipboard, Search, Copy, RefreshCw } from 'lucide-svelte'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'

  let {
    connectionId,
    dbType,
    schemaName,
    objectName,
    objectType = 'table',
  }: {
    connectionId: number
    dbType: string
    schemaName: string
    objectName: string
    objectType?: 'table' | 'view' | 'matview' | 'function'
  } = $props()

  let readonly = $derived(objectType !== 'table')

  let columns = $state<string[]>([])
  let primaryKeys = $state<string[]>([])
  let columnDefaults = $state<Record<string, string | null>>({})
  let rows = $state<Record<string, unknown>[]>([])
  let loading = $state(true)
  let fetching = $state(false)
  let error = $state<string | null>(null)
  let pageSize = $state(100)
  let currentPage = $state(1)
  let sortKeys = $state<{ col: string; dir: 'asc' | 'desc' }[]>([])
  let editingCell = $state<{ rowIdx: number; col: string } | null>(null)
  let editedData = $state<Record<number, Record<string, unknown>>>({})
  let newRows = $state<Record<string, unknown>[]>([])
  let selectedRows = $state<Set<number>>(new Set())
  let deletedRows = $state<Set<number>>(new Set())
  let searchQuery = $state('')
  let colWidths = $state<Record<string, number>>({})
  let resizing = $state<{ col: string; startX: number; startWidth: number } | null>(null)
  let columnTypes = $state<Record<string, string>>({})
  let frozenCols = $state<string[]>([])
  let colContextMenu = $state<{ open: boolean; x: number; y: number; col: string }>({ open: false, x: 0, y: 0, col: '' })

  let totalCount = $state(0)
  let searchTimeout: ReturnType<typeof setTimeout> | null = null
  let jsonModal = $state<{ open: boolean; title: string; content: string }>({ open: false, title: '', content: '' })
  let jsonCopied = $state(false)

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function highlightText(text: string, query: string): string {
    const q = query.trim()
    if (!q) return escapeHtml(text)
    const lower = text.toLowerCase()
    const lowerQ = q.toLowerCase()
    const parts: string[] = []
    let last = 0
    let idx = lower.indexOf(lowerQ)
    while (idx !== -1) {
      parts.push(escapeHtml(text.slice(last, idx)))
      parts.push(`<mark class="rounded-sm bg-yellow-300/70 text-inherit dark:bg-yellow-500/50">${escapeHtml(text.slice(idx, idx + q.length))}</mark>`)
      last = idx + q.length
      idx = lower.indexOf(lowerQ, last)
    }
    parts.push(escapeHtml(text.slice(last)))
    return parts.join('')
  }

  function tryParseJson(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2)
      } catch {
        return null
      }
    }
    return null
  }

  function openJsonModal(col: string, value: unknown): void {
    const formatted = tryParseJson(value)
    if (!formatted) return
    jsonModal = { open: true, title: col, content: formatted }
    jsonCopied = false
  }

  async function copyJsonContent(): Promise<void> {
    await navigator.clipboard.writeText(jsonModal.content)
    jsonCopied = true
    setTimeout(() => { jsonCopied = false }, 1500)
  }

  const pageSizeOptions = [100, 200, 500, 1000, 0]

  let allPageSelected = $derived(
    rows.length > 0 && rows.every((r) => selectedRows.has(getRowIdx(r)))
  )
  let hasChanges = $derived(Object.keys(editedData).length > 0 || newRows.length > 0 || deletedRows.size > 0)
  let totalPages = $derived(pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalCount / pageSize)))
  let pagedRows = $derived(rows)
  let displayColumns = $derived([
    ...frozenCols.filter((c) => columns.includes(c)),
    ...columns.filter((c) => !frozenCols.includes(c)),
  ])

  function clearEdits(): void {
    editedData = {}
    editingCell = null
    newRows = []
    deletedRows = new Set()
    selectedRows = new Set()
  }

  function goFirst(): void { clearEdits(); currentPage = 1; void load() }
  function goPrev(): void { if (currentPage > 1) { clearEdits(); currentPage -= 1; void load() } }
  function goNext(): void { if (currentPage < totalPages) { clearEdits(); currentPage += 1; void load() } }
  function goLast(): void { clearEdits(); currentPage = totalPages; void load() }

  function getOrderedFrozen(): string[] {
    return frozenCols.filter((c) => columns.includes(c))
  }

  function getFrozenStyle(col: string, zIndex: number = 1): string {
    const ordered = getOrderedFrozen()
    if (!ordered.includes(col)) return ''
    const fixedWidth = (readonly ? 0 : 32) + 40
    const left = fixedWidth + ordered.slice(0, ordered.indexOf(col)).reduce((sum, c) => sum + (colWidths[c] ?? 120), 0)
    return `position: sticky; left: ${left}px; z-index: ${zIndex};`
  }

  function isBooleanCol(col: string): boolean {
    return columnTypes[col] === 'bool'
  }

  function isTimestampCol(col: string): boolean {
    const t = columnTypes[col] ?? ''
    return t.startsWith('timestamp') || t === 'date' || t === 'timetz' || t === 'time'
  }

  function getCellClass(col: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return ''
    const type = columnTypes[col] ?? ''
    if (/^(int2|int4|int8|float4|float8|numeric|money|oid|xid|cid|serial|bigserial|smallint|integer|bigint|real|double precision|decimal)/.test(type)) return 'cell-numeric'
    return ''
  }

  function isTruthyBool(value: unknown): boolean {
    return value === true || value === 't' || value === 'true' || value === 'yes' || value === '1'
  }

  function formatTimestampValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    try {
      const d = new Date(String(value))
      if (isNaN(d.getTime())) return String(value)
      return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return String(value)
    }
  }

  function isLastFrozen(col: string): boolean {
    const ordered = getOrderedFrozen()
    return ordered.length > 0 && ordered[ordered.length - 1] === col
  }

  function handleColContextMenu(e: MouseEvent, col: string): void {
    e.preventDefault()
    colContextMenu = { open: true, x: e.clientX, y: e.clientY, col }
  }

  function closeColContextMenu(): void {
    colContextMenu = { ...colContextMenu, open: false }
  }

  function ctxSortAsc(col: string): void {
    const idx = sortKeys.findIndex((k) => k.col === col)
    if (idx === -1) sortKeys = [...sortKeys, { col, dir: 'asc' }]
    else sortKeys = sortKeys.map((k, i) => i === idx ? { ...k, dir: 'asc' } : k)
    clearEdits(); currentPage = 1; void load()
    closeColContextMenu()
  }

  function ctxSortDesc(col: string): void {
    const idx = sortKeys.findIndex((k) => k.col === col)
    if (idx === -1) sortKeys = [...sortKeys, { col, dir: 'desc' }]
    else sortKeys = sortKeys.map((k, i) => i === idx ? { ...k, dir: 'desc' } : k)
    clearEdits(); currentPage = 1; void load()
    closeColContextMenu()
  }

  function ctxClearSort(col: string): void {
    sortKeys = sortKeys.filter((k) => k.col !== col)
    clearEdits(); currentPage = 1; void load()
    closeColContextMenu()
  }

  function toggleFreeze(col: string): void {
    if (frozenCols.includes(col)) {
      frozenCols = frozenCols.filter((c) => c !== col)
    } else {
      if (!colWidths[col]) {
        const th = document.querySelector<HTMLElement>(`[data-col-header="${col}"]`)
        colWidths = { ...colWidths, [col]: th ? th.offsetWidth : 120 }
      }
      frozenCols = [...frozenCols, col]
    }
    closeColContextMenu()
  }

  function handleColClick(col: string): void {
    const idx = sortKeys.findIndex((k) => k.col === col)
    if (idx === -1) {
      sortKeys = [...sortKeys, { col, dir: 'asc' }]
    } else if (sortKeys[idx].dir === 'asc') {
      sortKeys = sortKeys.map((k, i) => i === idx ? { ...k, dir: 'desc' } : k)
    } else {
      sortKeys = sortKeys.filter((_, i) => i !== idx)
    }
    clearEdits()
    currentPage = 1
    void load()
  }

  function handleSearchInput(value: string): void {
    searchQuery = value
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
      currentPage = 1
      void load()
    }, 300)
  }

  function handleSearchClear(): void {
    searchQuery = ''
    if (searchTimeout) clearTimeout(searchTimeout)
    currentPage = 1
    void load()
  }

  function handleRefresh(): void {
    if (hasChanges && !confirm('저장되지 않은 변경사항이 있습니다. 새로고침하시겠습니까?')) return
    clearEdits()
    void load()
  }

  function handlePageSizeChange(value: number): void {
    pageSize = value
    clearEdits()
    currentPage = 1
    void load()
  }

  function getRowIdx(row: Record<string, unknown>): number {
    return row.__rowIdx as number
  }

  function getCellValue(row: Record<string, unknown>, col: string): unknown {
    const rowIdx = getRowIdx(row)
    return editedData[rowIdx]?.[col] !== undefined ? editedData[rowIdx][col] : row[col]
  }

  function isCellChanged(row: Record<string, unknown>, col: string): boolean {
    const rowIdx = getRowIdx(row)
    return editedData[rowIdx]?.[col] !== undefined && editedData[rowIdx][col] !== row[col]
  }

  async function handleDblClick(row: Record<string, unknown>, col: string): Promise<void> {
    editingCell = { rowIdx: getRowIdx(row), col }
    await tick()
    const input = document.querySelector<HTMLInputElement>(`[data-cell="${getRowIdx(row)}-${col}"]`)
    input?.focus()
    input?.select()
  }

  function handleCellInput(row: Record<string, unknown>, col: string, value: unknown): void {
    const rowIdx = getRowIdx(row)
    editedData = {
      ...editedData,
      [rowIdx]: { ...(editedData[rowIdx] ?? {}), [col]: value },
    }
  }

  function handleCellKeydown(e: KeyboardEvent, row: Record<string, unknown>, col: string): void {
    if (e.key === 'Escape') { editingCell = null; return }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      handleCellInput(row, col, null)
      editingCell = null
      return
    }
    if (e.key === 'Enter') {
      editingCell = null
      const ri = pagedRows.findIndex((r) => getRowIdx(r) === getRowIdx(row))
      if (ri < pagedRows.length - 1) void handleDblClick(pagedRows[ri + 1], col)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      editingCell = null
      const ri = pagedRows.findIndex((r) => getRowIdx(r) === getRowIdx(row))
      const ci = displayColumns.indexOf(col)
      let nextRi = ri
      let nextCi = e.shiftKey ? ci - 1 : ci + 1
      if (nextCi < 0) { nextRi -= 1; nextCi = displayColumns.length - 1 }
      if (nextCi >= displayColumns.length) { nextRi += 1; nextCi = 0 }
      if (nextRi >= 0 && nextRi < pagedRows.length) void handleDblClick(pagedRows[nextRi], displayColumns[nextCi])
    }
  }

  async function handleAddClick(): Promise<void> {
    const initialRow: Record<string, unknown> = {}
    for (const col of columns) {
      const def = columnDefaults[col]
      if (def !== null && def !== undefined && !/^nextval\s*\(/i.test(def)) {
        initialRow[col] = def
      }
    }
    newRows = [...newRows, initialRow]
    await tick()
    const idx = newRows.length - 1
    document.querySelector<HTMLInputElement>(`[data-new-cell="${idx}-0"]`)?.focus()
  }

  function handleNewRowInput(rowIdx: number, col: string, value: unknown): void {
    newRows = newRows.map((r, i) => i === rowIdx ? { ...r, [col]: value } : r)
  }

  function handleNewRowKeydown(e: KeyboardEvent, rowIdx: number): void {
    if (e.key === 'Escape') {
      newRows = newRows.filter((_, i) => i !== rowIdx)
    }
  }

  function downloadFile(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportCsv(): void {
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = columns.join(',')
    const body = pagedRows.map((row) => columns.map((col) => escape(row[col])).join(',')).join('\n')
    downloadFile(`${header}\n${body}`, `${objectName}.csv`, 'text/csv;charset=utf-8;')
  }

  function exportInsert(): void {
    const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`
    const quoteLiteral = (v: unknown): string => {
      if (v === null || v === undefined) return 'NULL'
      const s = String(v).replace(/'/g, "''")
      return `'${s}'`
    }
    const tableRef = `${quoteIdent(schemaName)}.${quoteIdent(objectName)}`
    const colList = columns.map(quoteIdent).join(', ')
    const lines = pagedRows.map((row) => {
      const vals = columns.map((col) => quoteLiteral(row[col])).join(', ')
      return `INSERT INTO ${tableRef} (${colList}) VALUES (${vals});`
    })
    downloadFile(lines.join('\n'), `${objectName}.sql`, 'text/plain;charset=utf-8;')
  }

  function copySelectedAsCsv(): void {
    const selectedRowData = rows.filter((r) => selectedRows.has(getRowIdx(r)))
    if (selectedRowData.length === 0) return
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = columns.join(',')
    const body = selectedRowData.map((row) => columns.map((col) => escape(getCellValue(row, col))).join(',')).join('\n')
    navigator.clipboard.writeText(`${header}\n${body}`)
  }

  function copySelectedAsInsert(): void {
    const selectedRowData = rows.filter((r) => selectedRows.has(getRowIdx(r)))
    if (selectedRowData.length === 0) return
    const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`
    const quoteLiteral = (v: unknown): string => {
      if (v === null || v === undefined) return 'NULL'
      const s = String(v).replace(/'/g, "''")
      return `'${s}'`
    }
    const tableRef = `${quoteIdent(schemaName)}.${quoteIdent(objectName)}`
    const colList = columns.map(quoteIdent).join(', ')
    const lines = selectedRowData.map((row) => {
      const vals = columns.map((col) => quoteLiteral(getCellValue(row, col))).join(', ')
      return `INSERT INTO ${tableRef} (${colList}) VALUES (${vals});`
    })
    navigator.clipboard.writeText(lines.join('\n'))
  }

  function toggleRowSelect(rowIdx: number): void {
    const next = new Set(selectedRows)
    if (next.has(rowIdx)) next.delete(rowIdx)
    else next.add(rowIdx)
    selectedRows = next
  }

  function toggleAllSelect(): void {
    if (allPageSelected) {
      const next = new Set(selectedRows)
      pagedRows.forEach((r) => next.delete(getRowIdx(r)))
      selectedRows = next
    } else {
      const next = new Set(selectedRows)
      pagedRows.forEach((r) => next.add(getRowIdx(r)))
      selectedRows = next
    }
  }

  function handleDeleteClick(): void {
    if (selectedRows.size === 0) return
    const next = new Set(deletedRows)
    selectedRows.forEach((idx) => next.add(idx))
    deletedRows = next
    selectedRows = new Set()
  }

  function handleDuplicateClick(): void {
    if (selectedRows.size === 0) return
    const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))
    const duplicated = pagedRows
      .filter((r) => selectedRows.has(getRowIdx(r)))
      .map((r) => {
        const newRow: Record<string, unknown> = {}
        for (const col of columns) {
          if (!primaryKeys.includes(col)) newRow[col] = r[col] ?? null
        }
        return plain(newRow)
      })
    newRows = [...newRows, ...duplicated]
  }

  function startResize(e: MouseEvent, col: string, th: HTMLElement): void {
    e.preventDefault()
    e.stopPropagation()
    const startWidth = colWidths[col] ?? th.offsetWidth
    resizing = { col, startX: e.clientX, startWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: MouseEvent): void {
      if (!resizing) return
      const delta = ev.clientX - resizing.startX
      colWidths = { ...colWidths, [resizing.col]: Math.max(40, resizing.startWidth + delta) }
    }

    function onUp(): void {
      resizing = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function handleSave(): Promise<void> {
    const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))

    const inserts = newRows.filter((r) => Object.keys(r).length > 0).map(plain)

    const updates = Object.entries(editedData).map(([idxStr, changes]) => {
      const rowIdx = Number(idxStr)
      const original = plain(rows.find((r) => r.__rowIdx === rowIdx) ?? {})
      return { original, changes: plain(changes) }
    })

    const deletes = [...deletedRows].map((rowIdx) => {
      return plain(rows.find((r) => r.__rowIdx === rowIdx) ?? {})
    })

    try {
      await window.api.executeDataChanges(connectionId, {
        schemaName,
        tableName: objectName,
        primaryKeys: [...primaryKeys],
        inserts,
        updates,
        deletes,
      })
      clearEdits()
      await load()
    } catch (err) {
      console.error('저장 실패:', err)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  function handleCancel(): void {
    clearEdits()
  }

  async function load(): Promise<void> {
    if (loading) {
      // 초기 로드: 전체 스피너
    } else {
      fetching = true
    }
    error = null
    try {
      const result = await window.api.selectAll(connectionId, schemaName, objectName, {
        limit: pageSize,
        offset: pageSize === 0 ? 0 : (currentPage - 1) * pageSize,
        orderBy: sortKeys.map(({ col, dir }) => ({ col, dir })),
        search: searchQuery.trim(),
      })
      columns = result.columns
      primaryKeys = result.primaryKeys
      rows = result.rows.map((r, i) => ({ ...r, __rowIdx: i }))
      totalCount = result.totalCount
      columnDefaults = result.columnDefaults
      columnTypes = result.columnTypes
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
      fetching = false
    }
  }

  onMount(() => { void load() })
</script>

{#if loading}
  <div class="flex h-full items-center justify-center text-muted-foreground">
    <div class="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground/60"></div>
  </div>
{:else if error}
  <div class="flex h-full items-center justify-center p-4">
    <p class="text-sm text-destructive">{error}</p>
  </div>
{:else}
  <div class="flex h-full flex-col">
    <!-- 툴바 -->
    <div class="flex shrink-0 items-center justify-between border-b border-border px-2 py-1 gap-2">
      <!-- 데이터 관리 -->
      <div class="flex items-center gap-1">
        {#if !readonly}
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors
              {hasChanges ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground/40 cursor-not-allowed'}"
            disabled={!hasChanges}
            onclick={handleSave}
          >
            <Save class="h-3 w-3" />
            저장
          </button>
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors
              {hasChanges ? 'text-muted-foreground hover:bg-accent hover:text-foreground' : 'text-muted-foreground/40 cursor-not-allowed'}"
            disabled={!hasChanges}
            onclick={handleCancel}
          >
            <X class="h-3 w-3" />
            취소
          </button>
          <div class="mx-1 h-4 w-px bg-border"></div>
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onclick={handleAddClick}
          >
            <Plus class="h-3 w-3" />
            추가
          </button>
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors
              {selectedRows.size > 0 ? 'text-muted-foreground hover:bg-accent hover:text-foreground' : 'text-muted-foreground/40 cursor-not-allowed'}"
            disabled={selectedRows.size === 0}
            onclick={handleDuplicateClick}
          >
            <Copy class="h-3 w-3" />
            복제{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
          </button>
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors
              {selectedRows.size > 0 ? 'text-muted-foreground hover:bg-accent hover:text-destructive' : 'text-muted-foreground/40 cursor-not-allowed'}"
            disabled={selectedRows.size === 0}
            onclick={handleDeleteClick}
          >
            <Trash2 class="h-3 w-3" />
            삭제{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
          </button>
          <div class="mx-1 h-4 w-px bg-border"></div>
        {/if}
        {#if !readonly}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <button class="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                <Download class="h-3 w-3" />
                Export
                <ChevronDown class="h-2.5 w-2.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="w-36">
              <DropdownMenu.Item onclick={exportCsv}>CSV (.csv)</DropdownMenu.Item>
              <DropdownMenu.Item onclick={exportInsert}>INSERT SQL (.sql)</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <button
                class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors
                  {selectedRows.size > 0 ? 'text-muted-foreground hover:bg-accent hover:text-foreground' : 'text-muted-foreground/40 cursor-not-allowed'}"
                disabled={selectedRows.size === 0}
              >
                <Clipboard class="h-3 w-3" />
                복사{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
                <ChevronDown class="h-2.5 w-2.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="w-40">
              <DropdownMenu.Item onclick={copySelectedAsCsv}>CSV로 복사</DropdownMenu.Item>
              <DropdownMenu.Item onclick={copySelectedAsInsert}>INSERT SQL로 복사</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
        <button
          class="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onclick={handleRefresh}
        >
          <RefreshCw class="h-3 w-3 {fetching ? 'animate-spin' : ''}" />
        </button>
      </div>

      <!-- 검색 -->
      <div class="relative flex items-center">
        <Search class="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground/60" />
        <input
          type="text"
          value={searchQuery}
          placeholder="값으로 필터..."
          class="h-6 w-48 rounded border border-border bg-background pl-6 pr-6 text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary focus:ring-0"
          oninput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
        />
        {#if searchQuery}
          <button
            class="absolute right-1.5 text-muted-foreground/60 hover:text-foreground"
            onclick={handleSearchClear}
          >
            <X class="h-3 w-3" />
          </button>
        {/if}
      </div>
      <span class="text-[11px] text-muted-foreground shrink-0">총 {totalCount}개 행</span>

      <!-- 페이징 -->
      <div class="flex items-center gap-1.5">
        <select
          value={pageSize}
          class="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none"
          onchange={(e) => handlePageSizeChange(Number((e.target as HTMLSelectElement).value))}
        >
          {#each pageSizeOptions as size}
            <option value={size}>{size === 0 ? '전체' : `${size}개씩`}</option>
          {/each}
        </select>
        <div class="flex items-center gap-0.5">
          <button
            class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            disabled={currentPage === 1}
            onclick={goFirst}
          >
            <ChevronsLeft class="h-3.5 w-3.5" />
          </button>
          <button
            class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            disabled={currentPage === 1}
            onclick={goPrev}
          >
            <ChevronLeft class="h-3.5 w-3.5" />
          </button>
          <span class="min-w-16 text-center text-[11px] text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <button
            class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            disabled={currentPage === totalPages}
            onclick={goNext}
          >
            <ChevronRight class="h-3.5 w-3.5" />
          </button>
          <button
            class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            disabled={currentPage === totalPages}
            onclick={goLast}
          >
            <ChevronsRight class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-auto min-h-0">
      <table class="w-full border-collapse text-[12px]">
        <thead class="sticky top-0 bg-muted">
          <tr>
            {#if !readonly}
              <th class="w-8 border-b border-border bg-muted" style="position: sticky; left: 0; z-index: 3;">
                <div class="flex items-center justify-center px-2 py-1.5">
                  <input
                    type="checkbox"
                    class="cursor-pointer accent-primary"
                    checked={allPageSelected}
                    indeterminate={selectedRows.size > 0 && !allPageSelected}
                    onchange={toggleAllSelect}
                  />
                </div>
              </th>
            {/if}
            <th
              class="w-10 border-b border-border bg-muted text-center text-[10px] font-medium text-muted-foreground/50 select-none"
              style="position: sticky; left: {readonly ? 0 : 32}px; z-index: 2;"
            >
              #
            </th>
            {#each displayColumns as col}
              {@const sortKey = sortKeys.find((k) => k.col === col)}
              {@const sortIdx = sortKeys.findIndex((k) => k.col === col)}
              {@const frozen = frozenCols.includes(col)}
              <th
                data-col-header={col}
                class="relative border-b border-border whitespace-nowrap {resizing?.col === col ? 'select-none' : ''} {frozen ? 'bg-muted' : ''} {isLastFrozen(col) ? 'border-r-2 border-r-primary/30' : ''}"
                style="{colWidths[col] ? `width: ${colWidths[col]}px; min-width: ${colWidths[col]}px; max-width: ${colWidths[col]}px;` : ''}{getFrozenStyle(col, 2)}"
                oncontextmenu={(e) => handleColContextMenu(e, col)}
              >
                <button
                  class="flex w-full items-center gap-1 px-3 py-1.5 text-left text-[11px] font-medium hover:bg-muted-foreground/10
                    {sortKey ? 'text-primary' : 'text-muted-foreground'}"
                  onclick={() => handleColClick(col)}
                >
                  <span class="truncate">{col}</span>
                  {#if sortKey}
                    <span class="flex shrink-0 items-center gap-0.5 text-primary">
                      {#if sortKey.dir === 'asc'}
                        <ArrowUp class="h-2.5 w-2.5" />
                      {:else}
                        <ArrowDown class="h-2.5 w-2.5" />
                      {/if}
                      {#if sortKeys.length > 1}
                        <span class="text-[9px] font-bold">{sortIdx + 1}</span>
                      {/if}
                    </span>
                  {:else}
                    <ArrowUpDown class="h-2.5 w-2.5 shrink-0 opacity-20" />
                  {/if}
                </button>
                <div
                  class="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50 {resizing?.col === col ? 'bg-primary/50' : ''}"
                  onmousedown={(e) => startResize(e, col, (e.currentTarget as HTMLElement).closest('th') as HTMLElement)}
                ></div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#if !readonly}
          {#each newRows as nr, nri}
            <tr class="bg-primary/5">
              <td class="w-8 border-b border-primary/30 px-2 bg-primary/5" style="position: sticky; left: 0; z-index: 1;">
                <button onclick={() => { newRows = newRows.filter((_, i) => i !== nri) }}>
                  <X class="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </td>
              <td class="w-10 border-b border-primary/30 bg-primary/5 text-center text-[10px] text-muted-foreground/40 select-none" style="position: sticky; left: {readonly ? 0 : 32}px; z-index: 1;">–</td>
              {#each displayColumns as col, ci}
                <td class="border-b border-primary/30 p-0 whitespace-nowrap">
                  {#if isBooleanCol(col)}
                    <div class="flex items-center px-3 py-1.5">
                      <input
                        data-new-cell="{nri}-{ci}"
                        type="checkbox"
                        class="accent-primary cursor-pointer"
                        checked={isTruthyBool(nr[col])}
                        onchange={(e) => handleNewRowInput(nri, col, (e.target as HTMLInputElement).checked)}
                      />
                    </div>
                  {:else}
                    <input
                      data-new-cell="{nri}-{ci}"
                      class="w-full min-w-20 bg-transparent px-3 py-1.5 text-[12px] text-foreground outline-none focus:outline focus:outline-1 focus:outline-primary"
                      placeholder={col}
                      value={String(nr[col] ?? '')}
                      oninput={(e) => handleNewRowInput(nri, col, (e.target as HTMLInputElement).value)}
                      onkeydown={(e) => handleNewRowKeydown(e, nri)}
                    />
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
          {/if}
          {#if pagedRows.length === 0 && newRows.length === 0}
            <tr>
              <td colspan={readonly ? columns.length : columns.length + 1} class="px-3 py-6 text-center text-sm text-muted-foreground">
                데이터가 없습니다
              </td>
            </tr>
          {/if}
          {#each pagedRows as row, rowIndex}
            {@const rowIdx = getRowIdx(row)}
            {@const isDeleted = deletedRows.has(rowIdx)}
            {@const isSelected = selectedRows.has(rowIdx)}
            {@const rowNumber = pageSize === 0 ? rowIndex + 1 : (currentPage - 1) * pageSize + rowIndex + 1}
            <tr class="
              {isDeleted ? 'bg-destructive/10' : isSelected ? 'bg-primary/5' : Object.keys(editedData[rowIdx] ?? {}).length > 0 ? 'bg-amber-500/5' : 'hover:bg-muted/40'}
            ">
              {#if !readonly}
                <td
                  class="w-8 border-b border-border px-2 {isDeleted ? 'bg-destructive/10' : isSelected ? 'bg-primary/5' : Object.keys(editedData[rowIdx] ?? {}).length > 0 ? 'bg-amber-500/5' : 'bg-background'}"
                  style="position: sticky; left: 0; z-index: 1;"
                >
                  <input
                    type="checkbox"
                    class="cursor-pointer accent-primary"
                    checked={isSelected}
                    disabled={isDeleted}
                    onchange={() => toggleRowSelect(rowIdx)}
                  />
                </td>
              {/if}
              <td
                class="w-10 border-b border-border text-center text-[10px] text-muted-foreground/40 select-none {isDeleted ? 'bg-destructive/10' : isSelected ? 'bg-primary/5' : Object.keys(editedData[rowIdx] ?? {}).length > 0 ? 'bg-amber-500/5' : 'bg-background'}"
                style="position: sticky; left: {readonly ? 0 : 32}px; z-index: 1;"
              >{rowNumber}</td>
              {#each displayColumns as col}
                {@const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.col === col}
                {@const changed = isCellChanged(row, col)}
                {@const value = getCellValue(row, col)}
                {@const originalValue = row[col]}
                {@const frozen = frozenCols.includes(col)}
                <td
                  class="border-b border-border p-0 whitespace-nowrap {changed && !isDeleted ? 'bg-amber-500/10' : frozen ? (isDeleted ? 'bg-destructive/10' : isSelected ? 'bg-primary/5' : Object.keys(editedData[rowIdx] ?? {}).length > 0 ? 'bg-amber-500/5' : 'bg-background') : ''} {isLastFrozen(col) ? 'border-r-2 border-r-primary/30' : ''}"
                  style={getFrozenStyle(col, 1)}
                  title={changed && !isDeleted ? `원래 값: ${originalValue === null || originalValue === undefined ? 'NULL' : originalValue === '' ? '(빈 문자열)' : String(originalValue)}` : undefined}
                  ondblclick={() => { if (!isDeleted && !readonly && !isBooleanCol(col)) handleDblClick(row, col) }}
                >
                  {#if isBooleanCol(col)}
                    <div class="px-3 py-1.5">
                      <input
                        type="checkbox"
                        class="accent-primary {!isDeleted && !readonly ? 'cursor-pointer' : 'cursor-default'}"
                        checked={isTruthyBool(value)}
                        disabled={isDeleted || readonly}
                        onchange={(e) => handleCellInput(row, col, (e.target as HTMLInputElement).checked)}
                      />
                    </div>
                  {:else if isEditing}
                    <input
                      data-cell="{rowIdx}-{col}"
                      class="h-full w-full min-w-20 bg-primary/5 px-3 py-1.5 text-[12px] {value === null ? 'text-muted-foreground/50 italic' : 'text-foreground'} outline outline-1 outline-primary"
                      value={value === null ? '' : String(value ?? '')}
                      placeholder={value === null ? 'NULL' : ''}
                      oninput={(e) => handleCellInput(row, col, (e.target as HTMLInputElement).value)}
                      onkeydown={(e) => handleCellKeydown(e, row, col)}
                      onblur={() => { editingCell = null }}
                    />
                  {:else}
                    {@const isJson = !isDeleted && tryParseJson(value) !== null}
                    <div
                      class="px-3 py-1.5 cursor-default select-none flex items-center gap-1.5 min-w-0"
                      onclick={() => { if (isJson) openJsonModal(col, value) }}
                    >
                      {#if value === null || value === undefined}
                        <span class="text-muted-foreground/50 italic {isDeleted ? 'line-through opacity-50' : ''}">NULL</span>
                      {:else if value === ''}
                        <span class="rounded bg-muted-foreground/15 px-1 text-[10px] text-muted-foreground/60 {isDeleted ? 'line-through opacity-50' : ''}">empty</span>
                      {:else if isTimestampCol(col)}
                        <span class="truncate {isDeleted ? 'line-through text-destructive/60' : changed ? 'text-amber-600 dark:text-amber-400' : 'cell-datetime'}">{formatTimestampValue(value)}</span>
                      {:else}
                        <span class="truncate {isDeleted ? 'line-through text-destructive/60' : changed ? 'text-amber-600 dark:text-amber-400' : getCellClass(col, value)}">{@html highlightText(String(value), searchQuery)}</span>
                        {#if isJson}
                          <span class="shrink-0 rounded bg-blue-500/15 px-1 text-[9px] font-medium text-blue-500 cursor-pointer">&#123;&#125;</span>
                        {/if}
                      {/if}
                    </div>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

{#if jsonModal.open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    onclick={() => { jsonModal.open = false }}
  >
    <div
      class="relative flex w-[560px] max-w-[90vw] flex-col rounded-lg border border-border bg-background shadow-xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span class="text-[13px] font-medium text-foreground">{jsonModal.title}</span>
        <div class="flex items-center gap-1">
          <button
            class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors
              {jsonCopied ? 'text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
            onclick={copyJsonContent}
          >
            <Copy class="h-3 w-3" />
            {jsonCopied ? '복사됨' : '복사'}
          </button>
          <button
            class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onclick={() => { jsonModal.open = false }}
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <pre class="max-h-[60vh] overflow-auto p-4 text-[12px] text-foreground font-mono leading-relaxed whitespace-pre-wrap break-all">{jsonModal.content}</pre>
    </div>
  </div>
{/if}

{#if colContextMenu.open}
  <div
    class="fixed inset-0 z-40"
    onclick={closeColContextMenu}
    oncontextmenu={(e) => { e.preventDefault(); closeColContextMenu() }}
  ></div>
  <div
    class="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
    style="left: {colContextMenu.x}px; top: {colContextMenu.y}px;"
  >
    <div class="px-2 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">{colContextMenu.col}</div>
    <div class="my-0.5 h-px bg-border"></div>
    <button
      class="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
      onclick={() => ctxSortAsc(colContextMenu.col)}
    >
      <ArrowUp class="h-3 w-3 text-muted-foreground" />
      오름차순 정렬
    </button>
    <button
      class="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
      onclick={() => ctxSortDesc(colContextMenu.col)}
    >
      <ArrowDown class="h-3 w-3 text-muted-foreground" />
      내림차순 정렬
    </button>
    {#if sortKeys.some((k) => k.col === colContextMenu.col)}
      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-accent"
        onclick={() => ctxClearSort(colContextMenu.col)}
      >
        <X class="h-3 w-3" />
        정렬 해제
      </button>
    {/if}
    <div class="my-0.5 h-px bg-border"></div>
    <button
      class="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
      onclick={() => toggleFreeze(colContextMenu.col)}
    >
      <span class="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-muted-foreground/40 {frozenCols.includes(colContextMenu.col) ? 'bg-primary border-primary' : ''}">
        {#if frozenCols.includes(colContextMenu.col)}
          <svg viewBox="0 0 12 12" class="h-2.5 w-2.5 text-primary-foreground" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M2 6l3 3 5-5" />
          </svg>
        {/if}
      </span>
      컬럼 고정
    </button>
  </div>
{/if}
