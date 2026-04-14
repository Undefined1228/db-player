<script lang="ts">
  import { onDestroy } from 'svelte'
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Select from '$lib/components/ui/select'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'

  interface ColumnInfo {
    name: string
    dataType: string
    nullable: boolean
    isPrimaryKey: boolean
    defaultValue: string | null
  }

  interface Props {
    open: boolean
    connectionId: number
    schemaName: string
    tableName: string
    tableColumns: ColumnInfo[]
    onImported: () => void
    onClose: () => void
  }

  let { open, connectionId, schemaName, tableName, tableColumns, onImported, onClose }: Props = $props()

  type Step = 'idle' | 'preview' | 'mapping' | 'importing' | 'done' | 'error'

  let step = $state<Step>('idle')
  let filePath = $state<string | null>(null)
  let csvHeaders = $state<string[]>([])
  let csvPreview = $state<Record<string, string>[]>([])
  let totalEstimated = $state(0)
  let columnMapping = $state<Record<string, string | null>>({})
  let skipFirstRow = $state(true)
  let progressDone = $state(0)
  let insertedRows = $state(0)
  let errorMessage = $state('')

  const SKIP_OPTION = '__skip__'

  $effect(() => {
    if (open && step === 'idle') {
      void pickAndPreview()
    }
  })

  async function pickAndPreview(): Promise<void> {
    const picked = await window.api.csvPickFile()
    if (!picked) {
      onClose()
      return
    }
    filePath = picked
    step = 'preview'
    try {
      const result = await window.api.csvPreview(picked)
      csvHeaders = result.headers
      csvPreview = result.preview
      totalEstimated = result.totalEstimated
      initMapping()
      step = 'mapping'
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      step = 'error'
    }
  }

  function initMapping(): void {
    const mapping: Record<string, string | null> = {}
    for (const header of csvHeaders) {
      const match = tableColumns.find(
        (col) => col.name.toLowerCase() === header.toLowerCase()
      )
      mapping[header] = match ? match.name : null
    }
    columnMapping = mapping
  }

  const requiredUnmapped = $derived(
    tableColumns
      .filter((col) => !col.nullable && col.defaultValue === null && !col.isPrimaryKey)
      .filter((col) => !Object.values(columnMapping).includes(col.name))
  )

  const canImport = $derived(requiredUnmapped.length === 0)

  async function startImport(): Promise<void> {
    if (!filePath) return
    step = 'importing'
    progressDone = 0

    const progressHandler = (data: { done: number }): void => {
      progressDone = data.done
    }
    window.api.onCsvProgress(progressHandler)

    try {
      const result = await window.api.csvImport({
        connectionId,
        schemaName,
        tableName,
        filePath,
        columnMapping: { ...columnMapping },
        columnTypes: Object.fromEntries(tableColumns.map((c) => [c.name, c.dataType])),
        skipFirstRow,
      })
      insertedRows = result.insertedRows
      step = 'done'
      onImported()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      step = 'error'
    } finally {
      window.api.offCsvProgress(progressHandler)
    }
  }

  function retry(): void {
    step = 'idle'
    filePath = null
    csvHeaders = []
    csvPreview = []
    columnMapping = {}
    progressDone = 0
    insertedRows = 0
    errorMessage = ''
    void pickAndPreview()
  }

  onDestroy(() => {
    // 혹시 남은 리스너 정리는 importHandler 로컬 변수로 관리되므로 추가 정리 불필요
  })

  const progressPercent = $derived(
    totalEstimated > 0 ? Math.min(100, Math.round((progressDone / totalEstimated) * 100)) : 0
  )
</script>

<Dialog.Root
  open={open}
  onOpenChange={(v) => {
    if (!v) onClose()
  }}
>
  <Dialog.Content class="max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>CSV로 가져오기 — {tableName}</Dialog.Title>
    </Dialog.Header>

    {#if step === 'idle'}
      <div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
        파일을 선택하는 중...
      </div>

    {:else if step === 'mapping'}
      <div class="space-y-4">
        <div class="flex items-center gap-2">
          <Checkbox id="skip-first-row" bind:checked={skipFirstRow} />
          <Label for="skip-first-row">첫 행을 헤더로 사용</Label>
        </div>

        <div class="max-h-64 overflow-auto rounded border">
          <table class="w-full text-xs">
            <thead class="sticky top-0 bg-muted">
              <tr>
                <th class="px-3 py-2 text-left font-medium text-muted-foreground">CSV 컬럼</th>
                <th class="px-3 py-2 text-left font-medium text-muted-foreground">테이블 컬럼</th>
              </tr>
            </thead>
            <tbody>
              {#each csvHeaders as header}
                <tr class="border-t">
                  <td class="px-3 py-1.5 font-mono text-foreground">{header}</td>
                  <td class="px-3 py-1.5">
                    <Select.Root
                      type="single"
                      value={columnMapping[header] ?? SKIP_OPTION}
                      onValueChange={(v) => {
                        columnMapping[header] = v === SKIP_OPTION ? null : v
                      }}
                    >
                      <Select.Trigger class="h-7 w-48 text-xs">
                        {#snippet child({ props })}
                          <button {...props}>
                            {columnMapping[header] ?? '(무시)'}
                          </button>
                        {/snippet}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value={SKIP_OPTION}>(무시)</Select.Item>
                        {#each tableColumns as col}
                          <Select.Item value={col.name}>
                            {col.name}
                            {#if !col.nullable && col.defaultValue === null && !col.isPrimaryKey}
                              <span class="ml-1 text-red-500">*</span>
                            {/if}
                          </Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if csvPreview.length > 0}
          <details>
            <summary class="cursor-pointer text-xs text-muted-foreground">미리보기 ({csvPreview.length}행)</summary>
            <div class="mt-2 max-h-40 overflow-auto rounded border">
              <table class="w-full text-xs">
                <thead class="sticky top-0 bg-muted">
                  <tr>
                    {#each csvHeaders as h}
                      <th class="px-2 py-1 text-left font-medium text-muted-foreground">{h}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each csvPreview as row}
                    <tr class="border-t">
                      {#each csvHeaders as h}
                        <td class="px-2 py-1 font-mono text-foreground">{row[h] ?? ''}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
        {/if}

        {#if requiredUnmapped.length > 0}
          <p class="text-xs text-red-500">
            필수 컬럼 미매핑: {requiredUnmapped.map((c) => c.name).join(', ')}
          </p>
        {/if}
      </div>

    {:else if step === 'importing'}
      <div class="space-y-3 py-4">
        <p class="text-sm text-muted-foreground">데이터를 가져오는 중... {progressDone.toLocaleString()}행 완료</p>
        <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-primary transition-all duration-300"
            style="width: {progressPercent}%"
          ></div>
        </div>
        <p class="text-xs text-muted-foreground text-right">{progressPercent}%</p>
      </div>

    {:else if step === 'done'}
      <div class="py-4 text-center space-y-2">
        <p class="text-sm font-medium text-foreground">{insertedRows.toLocaleString()}행을 성공적으로 가져왔습니다.</p>
      </div>

    {:else if step === 'error'}
      <div class="py-4 space-y-2">
        <p class="text-sm text-red-500">{errorMessage}</p>
      </div>
    {/if}

    <Dialog.Footer>
      {#if step === 'mapping'}
        <Button variant="outline" onclick={onClose}>취소</Button>
        <Button onclick={startImport} disabled={!canImport}>가져오기</Button>
      {:else if step === 'done'}
        <Button onclick={onClose}>닫기</Button>
      {:else if step === 'error'}
        <Button variant="outline" onclick={onClose}>닫기</Button>
        <Button onclick={retry}>다시 시도</Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
