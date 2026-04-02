<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Tabs from '$lib/components/ui/tabs'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Plus, Trash2, GripVertical, Loader2 } from 'lucide-svelte'

  let {
    open = $bindable(false),
    connectionId,
    dbType,
    schemaName,
    onCreated
  }: {
    open: boolean
    connectionId: number
    dbType: string
    schemaName: string
    onCreated: () => void
  } = $props()

  interface ColumnDef {
    id: string
    name: string
    type: string
    size: string
    nullable: boolean
    primaryKey: boolean
    defaultValue: string
  }

  interface ForeignKey {
    id: string
    constraintName: string
    localColumns: string[]
    refSchema: string
    refTable: string
    refColumns: string[]
    onDelete: string
    onUpdate: string
  }

  const PG_TYPE_GROUPS = [
    { group: '정수', types: ['integer', 'bigint', 'smallint', 'serial', 'bigserial'] },
    { group: '실수', types: ['numeric', 'real', 'double precision'] },
    { group: '문자', types: ['text', 'varchar', 'char'] },
    { group: '날짜/시간', types: ['date', 'time', 'timestamp', 'timestamptz', 'interval'] },
    { group: '기타', types: ['boolean', 'uuid', 'json', 'jsonb', 'bytea'] }
  ]

  const MYSQL_TYPE_GROUPS = [
    { group: '정수', types: ['int', 'bigint', 'smallint', 'tinyint', 'int auto_increment', 'bigint auto_increment'] },
    { group: '실수', types: ['decimal', 'float', 'double'] },
    { group: '문자', types: ['varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext'] },
    { group: '날짜/시간', types: ['date', 'time', 'datetime', 'timestamp'] },
    { group: '기타', types: ['tinyint(1)', 'json', 'blob'] }
  ]

  const TYPE_GROUPS = $derived((dbType === 'mysql' || dbType === 'mariadb') ? MYSQL_TYPE_GROUPS : PG_TYPE_GROUPS)

  const PG_SIZE_TYPES = new Set(['varchar', 'char', 'numeric'])
  const MYSQL_SIZE_TYPES = new Set(['varchar', 'char', 'decimal'])
  const SIZE_TYPES = $derived((dbType === 'mysql' || dbType === 'mariadb') ? MYSQL_SIZE_TYPES : PG_SIZE_TYPES)

  const FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']

  let tableName = $state('')
  let columns = $state<ColumnDef[]>([makeColumn()])
  let foreignKeys = $state<ForeignKey[]>([])
  let tableNameError = $state(false)
  let columnErrors = $state<Set<number>>(new Set())
  let activeTab = $state('columns')
  let saving = $state(false)
  let error = $state<string | null>(null)

  let schemas = $state<string[]>([])
  let tablesBySchema = $state<Map<string, string[]>>(new Map())
  let loadingTables = $state<Set<string>>(new Set())
  let columnsByTable = $state<Map<string, string[]>>(new Map())
  let loadingColumns = $state<Set<string>>(new Set())

  let namedColumns = $derived(columns.filter((c) => c.name.trim()))

  $effect(() => {
    if (open) {
      tableName = ''
      columns = [makeColumn()]
      foreignKeys = []
      tableNameError = false
      columnErrors = new Set()
      error = null
      schemas = []
      tablesBySchema = new Map()
      loadingTables = new Set()
      columnsByTable = new Map()
      loadingColumns = new Set()
      loadSchemas()
    }
  })

  async function loadSchemas(): Promise<void> {
    try {
      const result = await window.api.getSchemas(connectionId)
      schemas = result.map((s) => s.name)
      if (schemas.includes(schemaName)) {
        await loadTablesForSchema(schemaName)
      }
    } catch {
      schemas = []
    }
  }

  async function loadTablesForSchema(s: string): Promise<void> {
    if (tablesBySchema.has(s) || loadingTables.has(s)) return
    loadingTables = new Set([...loadingTables, s])
    try {
      const tables = await window.api.getTableNames(connectionId, s)
      tablesBySchema = new Map([...tablesBySchema, [s, tables]])
    } catch {
      tablesBySchema = new Map([...tablesBySchema, [s, []]])
    } finally {
      loadingTables = new Set([...loadingTables].filter((x) => x !== s))
    }
  }

  async function onRefSchemaChange(fkIdx: number, s: string): Promise<void> {
    foreignKeys[fkIdx].refSchema = s
    foreignKeys[fkIdx].refTable = ''
    foreignKeys[fkIdx].refColumns = []
    await loadTablesForSchema(s)
  }

  async function onRefTableChange(fkIdx: number, t: string): Promise<void> {
    foreignKeys[fkIdx].refTable = t
    foreignKeys[fkIdx].refColumns = []
    if (t) await loadColumnsForTable(foreignKeys[fkIdx].refSchema, t)
  }

  async function loadColumnsForTable(schema: string, table: string): Promise<void> {
    const key = `${schema}.${table}`
    if (columnsByTable.has(key) || loadingColumns.has(key)) return
    loadingColumns = new Set([...loadingColumns, key])
    try {
      const cols = await window.api.getColumnNames(connectionId, schema, table)
      columnsByTable = new Map([...columnsByTable, [key, cols]])
    } catch {
      columnsByTable = new Map([...columnsByTable, [key, []]])
    } finally {
      loadingColumns = new Set([...loadingColumns].filter((x) => x !== key))
    }
  }

  function toggleRefColumn(fkIdx: number, col: string): void {
    const fk = foreignKeys[fkIdx]
    if (fk.refColumns.includes(col)) {
      fk.refColumns = fk.refColumns.filter((c) => c !== col)
    } else {
      fk.refColumns = [...fk.refColumns, col]
    }
  }

  function makeColumn(): ColumnDef {
    return {
      id: crypto.randomUUID(),
      name: '',
      type: 'varchar',
      size: '255',
      nullable: true,
      primaryKey: false,
      defaultValue: ''
    }
  }

  function makeForeignKey(): ForeignKey {
    return {
      id: crypto.randomUUID(),
      constraintName: '',
      localColumns: [],
      refSchema: schemaName,
      refTable: '',
      refColumns: [],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION'
    }
  }

  function addColumn(): void {
    columns = [...columns, makeColumn()]
  }

  function removeColumn(idx: number): void {
    const removed = columns[idx].name
    columns = columns.filter((_, i) => i !== idx)
    foreignKeys = foreignKeys.map((fk) => ({
      ...fk,
      localColumns: fk.localColumns.filter((c) => c !== removed)
    }))
    columnErrors.delete(idx)
    columnErrors = new Set(columnErrors)
  }

  function togglePrimaryKey(idx: number): void {
    columns[idx].primaryKey = !columns[idx].primaryKey
    if (columns[idx].primaryKey) columns[idx].nullable = false
  }

  function onTypeChange(idx: number, type: string): void {
    columns[idx].type = type
    if (type === 'varchar') columns[idx].size = '255'
    else if (type === 'char') columns[idx].size = '1'
    else if (type === 'numeric' || type === 'decimal') columns[idx].size = '10,2'
    else columns[idx].size = ''
    columnErrors.delete(idx)
    columnErrors = new Set(columnErrors)
  }

  function toggleFkColumn(fkIdx: number, colName: string): void {
    const fk = foreignKeys[fkIdx]
    if (fk.localColumns.includes(colName)) {
      fk.localColumns = fk.localColumns.filter((c) => c !== colName)
    } else {
      fk.localColumns = [...fk.localColumns, colName]
    }
  }

  function addForeignKey(): void {
    foreignKeys = [...foreignKeys, makeForeignKey()]
    loadTablesForSchema(schemaName)
  }

  function removeForeignKey(idx: number): void {
    foreignKeys = foreignKeys.filter((_, i) => i !== idx)
  }

  function validate(): boolean {
    let valid = true
    if (!tableName.trim() || !/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(tableName)) {
      tableNameError = true
      valid = false
    }
    const newErrors = new Set<number>()
    columns.forEach((col, i) => {
      if (!col.name.trim() || !/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(col.name)) {
        newErrors.add(i)
        valid = false
      }
    })
    columnErrors = newErrors
    return valid
  }

  async function handleCreate(): Promise<void> {
    if (!validate()) return
    saving = true
    error = null
    try {
      await window.api.createTable(connectionId, $state.snapshot({
        schemaName,
        tableName: tableName.trim(),
        columns,
        foreignKeys
      }))
      open = false
      onCreated()
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function sizePlaceholder(type: string): string {
    if (type === 'numeric') return '정밀도,소수점 (예: 10,2)'
    return '길이 (예: 255)'
  }

  function selectClass(): string {
    return 'h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring'
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-4xl max-h-[90vh]">
    <Dialog.Header class="px-6 pt-6 pb-4 border-b border-border">
      <Dialog.Title>테이블 생성</Dialog.Title>
      <Dialog.Description>
        <span class="font-mono text-xs">{schemaName}</span> 스키마에 새 테이블을 생성합니다.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 min-h-0">
      <div class="flex items-center gap-4">
        <Label class="w-24 shrink-0 text-right text-xs">테이블 이름 *</Label>
        <div class="flex flex-col gap-1 flex-1">
          <Input
            bind:value={tableName}
            oninput={() => (tableNameError = false)}
            placeholder="my_table"
            class="h-8 text-xs {tableNameError ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''}"
          />
          {#if tableNameError}
            <p class="text-[10px] text-destructive-foreground">영문자/밑줄로 시작하고 영문자·숫자·밑줄·$만 사용 가능합니다.</p>
          {/if}
        </div>
      </div>

      <Tabs.Root bind:value={activeTab} class="flex flex-col gap-0 flex-1 min-h-0">
        <div class="flex items-center justify-between">
          <Tabs.List class="w-fit">
            <Tabs.Trigger value="columns" class="text-xs">컬럼</Tabs.Trigger>
            <Tabs.Trigger value="foreignkeys" class="text-xs">
              외래키
              {#if foreignKeys.length > 0}
                <span class="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{foreignKeys.length}</span>
              {/if}
            </Tabs.Trigger>
          </Tabs.List>
          {#if activeTab === 'columns'}
            <Button variant="outline" size="sm" class="h-7 text-xs gap-1" onclick={addColumn}>
              <Plus class="h-3.5 w-3.5" />
              컬럼 추가
            </Button>
          {:else}
            <Button variant="outline" size="sm" class="h-7 text-xs gap-1" onclick={addForeignKey}>
              <Plus class="h-3.5 w-3.5" />
              외래키 추가
            </Button>
          {/if}
        </div>

        <Tabs.Content value="columns" class="flex flex-col gap-2 mt-3">
          <div class="rounded-md border border-border overflow-hidden">
            <table class="w-full text-xs">
              <thead class="bg-muted/50">
                <tr class="border-b border-border">
                  <th class="w-6 px-2 py-2"></th>
                  <th class="px-2 py-2 text-left font-medium text-muted-foreground">이름 *</th>
                  <th class="px-2 py-2 text-left font-medium text-muted-foreground w-36">타입</th>
                  <th class="px-2 py-2 text-left font-medium text-muted-foreground w-40">크기/정밀도</th>
                  <th class="px-2 py-2 text-center font-medium text-muted-foreground w-16">PK</th>
                  <th class="px-2 py-2 text-center font-medium text-muted-foreground w-24">NULL 허용</th>
                  <th class="px-2 py-2 text-left font-medium text-muted-foreground w-32">기본값</th>
                  <th class="w-8 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {#each columns as col, idx (col.id)}
                  <tr class="border-b border-border last:border-0 hover:bg-muted/30">
                    <td class="px-2 py-1.5 text-muted-foreground">
                      <GripVertical class="h-3.5 w-3.5" />
                    </td>
                    <td class="px-2 py-1.5">
                      <Input
                        bind:value={col.name}
                        oninput={() => { columnErrors.delete(idx); columnErrors = new Set(columnErrors) }}
                        placeholder="column_name"
                        class="h-7 text-xs {columnErrors.has(idx) ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''}"
                      />
                    </td>
                    <td class="px-2 py-1.5">
                      <select
                        value={col.type}
                        onchange={(e) => onTypeChange(idx, (e.target as HTMLSelectElement).value)}
                        class={selectClass()}
                      >
                        {#each TYPE_GROUPS as group}
                          <optgroup label={group.group}>
                            {#each group.types as type}
                              <option value={type}>{type}</option>
                            {/each}
                          </optgroup>
                        {/each}
                      </select>
                    </td>
                    <td class="px-2 py-1.5">
                      {#if SIZE_TYPES.has(col.type)}
                        <Input bind:value={col.size} placeholder={sizePlaceholder(col.type)} class="h-7 text-xs" />
                      {:else}
                        <span class="text-muted-foreground px-1">—</span>
                      {/if}
                    </td>
                    <td class="px-2 py-1.5">
                      <div class="flex justify-center">
                        <Checkbox checked={col.primaryKey} onCheckedChange={() => togglePrimaryKey(idx)} />
                      </div>
                    </td>
                    <td class="px-2 py-1.5">
                      <div class="flex justify-center">
                        <Checkbox bind:checked={col.nullable} disabled={col.primaryKey} />
                      </div>
                    </td>
                    <td class="px-2 py-1.5">
                      <Input bind:value={col.defaultValue} placeholder="없음" class="h-7 text-xs" />
                    </td>
                    <td class="px-2 py-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-6 w-6 text-muted-foreground hover:text-destructive-foreground"
                        onclick={() => removeColumn(idx)}
                        disabled={columns.length === 1}
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if columnErrors.size > 0}
            <p class="text-[10px] text-destructive-foreground">
              컬럼 이름은 영문자/밑줄로 시작하고 영문자·숫자·밑줄·$만 사용 가능합니다.
            </p>
          {/if}
        </Tabs.Content>

        <Tabs.Content value="foreignkeys" class="flex flex-col gap-3 mt-3">
          {#if foreignKeys.length === 0}
            <div class="rounded-md border border-border border-dashed py-10 text-center text-xs text-muted-foreground">
              외래키 제약조건이 없습니다. "외래키 추가" 버튼을 눌러 추가하세요.
            </div>
          {:else}
            <div class="flex flex-col gap-3">
              {#each foreignKeys as fk, fkIdx (fk.id)}
                <div class="rounded-md border border-border p-4 flex flex-col gap-3">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-muted-foreground">외래키 {fkIdx + 1}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-6 w-6 text-muted-foreground hover:text-destructive-foreground"
                      onclick={() => removeForeignKey(fkIdx)}
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <Label class="text-[11px] text-muted-foreground">제약조건 이름 (선택)</Label>
                      <Input bind:value={fk.constraintName} placeholder="fk_테이블_컬럼" class="h-7 text-xs" />
                    </div>

                    <div class="flex flex-col gap-1">
                      <Label class="text-[11px] text-muted-foreground">로컬 컬럼 *</Label>
                      {#if namedColumns.length === 0}
                        <p class="text-[11px] text-muted-foreground px-1">컬럼 탭에서 컬럼을 먼저 정의하세요.</p>
                      {:else}
                        <div class="flex flex-wrap gap-x-3 gap-y-1.5 rounded-md border border-input px-2 py-1.5 min-h-7">
                          {#each namedColumns as col}
                            <label class="flex items-center gap-1.5 cursor-pointer">
                              <Checkbox
                                checked={fk.localColumns.includes(col.name)}
                                onCheckedChange={() => toggleFkColumn(fkIdx, col.name)}
                              />
                              <span class="text-xs font-mono">{col.name}</span>
                            </label>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <Label class="text-[11px] text-muted-foreground">참조 스키마 *</Label>
                      <select
                        value={fk.refSchema}
                        onchange={(e) => onRefSchemaChange(fkIdx, (e.target as HTMLSelectElement).value)}
                        class={selectClass()}
                      >
                        <option value="">스키마 선택</option>
                        {#each schemas as s}
                          <option value={s}>{s}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="flex flex-col gap-1">
                      <Label class="text-[11px] text-muted-foreground">참조 테이블 *</Label>
                      {#if loadingTables.has(fk.refSchema)}
                        <div class="flex items-center gap-1.5 h-7 px-2 rounded-md border border-input">
                          <Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
                          <span class="text-xs text-muted-foreground">로딩 중...</span>
                        </div>
                      {:else}
                        <select
                          value={fk.refTable}
                          disabled={!fk.refSchema}
                          onchange={(e) => onRefTableChange(fkIdx, (e.target as HTMLSelectElement).value)}
                          class={selectClass()}
                        >
                          <option value="">테이블 선택</option>
                          {#each tablesBySchema.get(fk.refSchema) ?? [] as t}
                            <option value={t}>{t}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  </div>

                  <div class="flex flex-col gap-1">
                    <Label class="text-[11px] text-muted-foreground">참조 컬럼 *</Label>
                    {#if !fk.refTable}
                      <p class="text-[11px] text-muted-foreground px-1">참조 테이블을 먼저 선택하세요.</p>
                    {:else if loadingColumns.has(`${fk.refSchema}.${fk.refTable}`)}
                      <div class="flex items-center gap-1.5 px-1">
                        <Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">로딩 중...</span>
                      </div>
                    {:else}
                      <div class="flex flex-wrap gap-x-3 gap-y-1.5 rounded-md border border-input px-2 py-1.5 min-h-7">
                        {#each columnsByTable.get(`${fk.refSchema}.${fk.refTable}`) ?? [] as col}
                          <label class="flex items-center gap-1.5 cursor-pointer">
                            <Checkbox
                              checked={fk.refColumns.includes(col)}
                              onCheckedChange={() => toggleRefColumn(fkIdx, col)}
                            />
                            <span class="text-xs font-mono">{col}</span>
                          </label>
                        {/each}
                      </div>
                    {/if}
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <Label class="text-[11px] text-muted-foreground">ON DELETE</Label>
                      <select
                        bind:value={fk.onDelete}
                        class={selectClass()}
                      >
                        {#each FK_ACTIONS as action}
                          <option value={action}>{action}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="flex flex-col gap-1">
                      <Label class="text-[11px] text-muted-foreground">ON UPDATE</Label>
                      <select
                        bind:value={fk.onUpdate}
                        class={selectClass()}
                      >
                        {#each FK_ACTIONS as action}
                          <option value={action}>{action}</option>
                        {/each}
                      </select>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </Tabs.Content>
      </Tabs.Root>
    </div>

    {#if error}
      <div class="mx-6 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
        {error}
      </div>
    {/if}
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
