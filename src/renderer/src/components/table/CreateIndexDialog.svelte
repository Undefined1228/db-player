<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import * as Select from '$lib/components/ui/select'
  import { Loader2, GripVertical, ArrowUp, ArrowDown } from 'lucide-svelte'

  interface ColumnInfo {
    name: string
    dataType: string
    nullable: boolean
    isPrimaryKey: boolean
    defaultValue: string | null
  }

  interface IndexColumn {
    name: string
    order: 'ASC' | 'DESC'
    selected: boolean
  }

  let {
    open = $bindable(false),
    connectionId,
    schemaName,
    tableName,
    tableColumns,
    onCreated
  }: {
    open: boolean
    connectionId: number
    schemaName: string
    tableName: string
    tableColumns: ColumnInfo[]
    onCreated: () => void
  } = $props()

  let indexName = $state('')
  let unique = $state(false)
  let method = $state('btree')
  let indexColumns = $state<IndexColumn[]>([])
  let indexNameError = $state(false)
  let columnsError = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)

  const methods = ['btree', 'hash', 'gin', 'gist', 'brin']

  $effect(() => {
    if (open) {
      indexName = ''
      unique = false
      method = 'btree'
      indexColumns = tableColumns.map((c) => ({ name: c.name, order: 'ASC' as const, selected: false }))
      indexNameError = false
      columnsError = false
      error = null
    }
  })

  function moveUp(i: number): void {
    if (i === 0) return
    const arr = [...indexColumns]
    ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
    indexColumns = arr
  }

  function moveDown(i: number): void {
    if (i === indexColumns.length - 1) return
    const arr = [...indexColumns]
    ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
    indexColumns = arr
  }

  function validate(): boolean {
    let valid = true
    if (!indexName.trim() || !/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(indexName.trim())) {
      indexNameError = true
      valid = false
    }
    if (!indexColumns.some((c) => c.selected)) {
      columnsError = true
      valid = false
    }
    return valid
  }

  async function handleCreate(): Promise<void> {
    if (!validate()) return
    saving = true
    error = null
    try {
      const selectedCols = indexColumns
        .filter((c) => c.selected)
        .map((c) => ({ name: c.name, order: c.order }))
      await window.api.createIndex(connectionId, {
        schemaName,
        tableName,
        indexName: indexName.trim(),
        columns: selectedCols,
        unique,
        method
      })
      open = false
      onCreated()
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-lg max-h-[90vh]">
    <Dialog.Header class="px-6 pt-6 pb-4 border-b border-border">
      <Dialog.Title>인덱스 생성</Dialog.Title>
      <Dialog.Description>
        <span class="font-mono text-xs">{schemaName}.{tableName}</span> 테이블에 인덱스를 생성합니다.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 min-h-0">
      <div class="flex items-center gap-4">
        <Label class="w-24 shrink-0 text-right text-xs">인덱스 이름 *</Label>
        <div class="flex flex-col gap-1 flex-1">
          <Input
            bind:value={indexName}
            oninput={() => (indexNameError = false)}
            placeholder="idx_table_column"
            class="h-8 text-xs {indexNameError ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''}"
          />
          {#if indexNameError}
            <p class="text-[10px] text-destructive-foreground">영문자/밑줄로 시작하고 영문자·숫자·밑줄·$만 사용 가능합니다.</p>
          {/if}
        </div>
      </div>

      <div class="flex items-center gap-4">
        <Label class="w-24 shrink-0 text-right text-xs">메서드</Label>
        <Select.Root type="single" bind:value={method}>
          <Select.Trigger class="h-8 text-xs flex-1">
            {method}
          </Select.Trigger>
          <Select.Content>
            {#each methods as m}
              <Select.Item value={m} class="text-xs">{m}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex items-center gap-4">
        <Label class="w-24 shrink-0 text-right text-xs">UNIQUE</Label>
        <Checkbox bind:checked={unique} />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <Label class="text-xs">컬럼 선택 *</Label>
          {#if columnsError}
            <span class="text-[10px] text-destructive-foreground">컬럼을 하나 이상 선택하세요.</span>
          {/if}
        </div>
        <div class="rounded-md border border-input overflow-hidden">
          <div class="grid text-[10px] font-medium text-muted-foreground bg-muted/50 px-2 py-1.5 border-b border-border" style="grid-template-columns: 1.5rem 1fr 5rem 3rem">
            <span></span>
            <span>컬럼</span>
            <span>정렬</span>
            <span class="text-center">순서</span>
          </div>
          <div class="max-h-48 overflow-y-auto">
            {#each indexColumns as col, i}
              <div
                class="grid items-center px-2 py-1.5 border-b border-border last:border-0 hover:bg-accent/30 {col.selected ? 'bg-primary/5' : ''}"
                style="grid-template-columns: 1.5rem 1fr 5rem 3rem"
              >
                <Checkbox
                  checked={col.selected}
                  onCheckedChange={(v) => {
                    indexColumns[i].selected = v === true
                    columnsError = false
                  }}
                />
                <span class="text-xs truncate">{col.name}</span>
                {#if col.selected}
                  <Select.Root
                    type="single"
                    value={col.order}
                    onValueChange={(v) => { if (v) indexColumns[i].order = v as 'ASC' | 'DESC' }}
                  >
                    <Select.Trigger class="h-6 text-[10px] py-0 px-1.5">
                      {col.order}
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="ASC" class="text-xs">ASC</Select.Item>
                      <Select.Item value="DESC" class="text-xs">DESC</Select.Item>
                    </Select.Content>
                  </Select.Root>
                {:else}
                  <span></span>
                {/if}
                <div class="flex items-center justify-center gap-0.5">
                  <button
                    class="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                    disabled={i === 0}
                    onclick={() => moveUp(i)}
                  >
                    <ArrowUp class="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button
                    class="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                    disabled={i === indexColumns.length - 1}
                    onclick={() => moveDown(i)}
                  >
                    <ArrowDown class="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>

      {#if error}
        <div class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </div>
      {/if}
    </div>

    <Dialog.Footer class="px-6 py-4 border-t border-border">
      <Button variant="outline" size="sm" onclick={() => (open = false)} disabled={saving}>취소</Button>
      <Button size="sm" onclick={handleCreate} disabled={saving}>
        {#if saving}
          <Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          생성 중...
        {:else}
          생성
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
