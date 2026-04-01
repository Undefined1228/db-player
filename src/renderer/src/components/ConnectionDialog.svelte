<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Select from '$lib/components/ui/select'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group'
  import { Loader2 } from 'lucide-svelte'
  import { loadConnections } from '$lib/stores/connections'

  let {
    open = $bindable(false),
    initialData = null
  }: {
    open: boolean
    initialData?: ConnectionWithPassword | null
  } = $props()

  type DbType = 'mysql' | 'postgresql' | 'sqlite'
  type InputMode = 'fields' | 'url'

  const dbTypes: { value: DbType; label: string; defaultPort: number; protocol: string }[] = [
    { value: 'mysql', label: 'MySQL', defaultPort: 3306, protocol: 'mysql' },
    { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432, protocol: 'postgresql' },
    { value: 'sqlite', label: 'SQLite', defaultPort: 0, protocol: 'sqlite' }
  ]

  let name = $state('')
  let dbType = $state<DbType>('mysql')
  let inputMode = $state<InputMode>('fields')
  let host = $state('localhost')
  let port = $state(3306)
  let database = $state('')
  let username = $state('')
  let password = $state('')
  let filePath = $state('')
  let url = $state('')

  let errors = $state<Set<string>>(new Set())
  let testing = $state(false)
  let saving = $state(false)
  let testResult = $state<{ success: boolean; message: string } | null>(null)

  function resetForm(): void {
    name = ''
    dbType = 'mysql'
    inputMode = 'fields'
    host = 'localhost'
    port = 3306
    database = ''
    username = ''
    password = ''
    filePath = ''
    url = ''
    errors = new Set()
    testResult = null
  }

  function populateForm(data: ConnectionWithPassword): void {
    name = data.name
    dbType = data.dbType as DbType
    inputMode = data.inputMode as InputMode
    host = data.host ?? 'localhost'
    port = data.port ?? dbTypes.find((t) => t.value === data.dbType)?.defaultPort ?? 3306
    database = data.databaseName ?? ''
    username = data.username ?? ''
    password = data.password
    filePath = data.filePath ?? ''
    url = data.url ?? ''
    errors = new Set()
    testResult = null
  }

  $effect(() => {
    if (open && initialData) {
      populateForm(initialData)
    } else if (!open) {
      resetForm()
    }
  })

  function onUrlInput(): void {
    clearError('url')
    const cleaned = url.replace(/^jdbc:/i, '')
    const match = cleaned.match(/^(\w+):\/\//)
    if (!match) return
    const protocol = match[1].toLowerCase()
    const found = dbTypes.find((t) => t.protocol === protocol)
    if (found && found.value !== dbType) {
      console.log('[URL 감지] DB 유형 변경:', dbType, '→', found.value)
      dbType = found.value
    }
  }

  let isSqlite = $derived(dbType === 'sqlite')

  let generatedUrl = $derived.by(() => {
    if (isSqlite) return `sqlite://${filePath}`
    const db = dbTypes.find((t) => t.value === dbType)
    return `${db?.protocol}://${host}:${port}${database ? `/${database}` : ''}`
  })

  function onDbTypeChange(value: string | undefined): void {
    if (!value) return
    dbType = value as DbType
    const selected = dbTypes.find((t) => t.value === value)
    if (selected) port = selected.defaultPort
    if (value === 'sqlite') inputMode = 'fields'
    errors = new Set()
    testResult = null
  }

  function clearError(field: string): void {
    errors.delete(field)
    errors = new Set(errors)
  }

  function validate(): boolean {
    const newErrors = new Set<string>()

    if (!name.trim()) newErrors.add('name')

    if (isSqlite) {
      if (!filePath.trim()) newErrors.add('filePath')
    } else if (inputMode === 'url') {
      if (!url.trim()) newErrors.add('url')
    } else {
      if (!host.trim()) newErrors.add('host')
      if (!port) newErrors.add('port')
    }

    errors = newErrors
    return newErrors.size === 0
  }

  function buildParams() {
    return {
      dbType,
      inputMode: isSqlite ? 'fields' : inputMode,
      host: host || undefined,
      port: port || undefined,
      database: database || undefined,
      username: username || undefined,
      password: password || undefined,
      filePath: filePath || undefined,
      url: url || undefined
    }
  }

  async function handleTest(): Promise<void> {
    if (!validate()) return
    testing = true
    testResult = null
    const params = buildParams()
    console.log('[연결 테스트] 요청:', params)
    try {
      testResult = await window.api.testConnection(params)
      console.log('[연결 테스트] 결과:', testResult)
    } catch (err: unknown) {
      console.error('[연결 테스트] 에러:', err)
      testResult = { success: false, message: err instanceof Error ? err.message : String(err) }
    } finally {
      testing = false
    }
  }

  async function handleSave(): Promise<void> {
    if (!validate()) return
    saving = true
    try {
      const params = { name, ...buildParams(), ...(initialData ? { id: initialData.id } : {}) }
      await window.api.saveConnection(params)
      await loadConnections()
      resetForm()
      open = false
    } catch (err: unknown) {
      console.error('[저장] 에러:', err)
    } finally {
      saving = false
    }
  }

  function handleCancel(): void {
    resetForm()
    open = false
  }

  function errorClass(field: string): string {
    return errors.has(field) ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[500px]">
    <Dialog.Header>
      <Dialog.Title>{initialData ? '연결 편집' : '새 연결'}</Dialog.Title>
      <Dialog.Description>{initialData ? '연결 정보를 수정하세요.' : '데이터베이스 연결 정보를 입력하세요.'}</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-4 py-4">
      <div class="grid grid-cols-4 items-center gap-4">
        <Label class="text-right text-xs">연결 이름 *</Label>
        <Input
          bind:value={name}
          oninput={() => clearError('name')}
          placeholder="My Database"
          class="col-span-3 h-8 text-xs {errorClass('name')}"
        />
      </div>

      <div class="grid grid-cols-4 items-center gap-4">
        <Label class="text-right text-xs">DB 유형</Label>
        <Select.Root type="single" value={dbType} onValueChange={onDbTypeChange}>
          <Select.Trigger class="col-span-3 h-8 text-xs">
            {dbTypes.find((t) => t.value === dbType)?.label ?? 'DB 선택'}
          </Select.Trigger>
          <Select.Content>
            {#each dbTypes as dt}
              <Select.Item value={dt.value} label={dt.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      {#if !isSqlite}
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">입력 방식</Label>
          <RadioGroup value={inputMode} onValueChange={(v) => { if (v) { inputMode = v as InputMode; errors = new Set(); testResult = null; } }} class="col-span-3 flex gap-4">
            <div class="flex items-center gap-1.5">
              <RadioGroupItem value="fields" id="mode-fields" />
              <Label for="mode-fields" class="text-xs font-normal">호스트/포트</Label>
            </div>
            <div class="flex items-center gap-1.5">
              <RadioGroupItem value="url" id="mode-url" />
              <Label for="mode-url" class="text-xs font-normal">URL</Label>
            </div>
          </RadioGroup>
        </div>
      {/if}

      {#if isSqlite}
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">파일 경로 *</Label>
          <Input
            bind:value={filePath}
            oninput={() => clearError('filePath')}
            placeholder="/path/to/database.db"
            class="col-span-3 h-8 text-xs {errorClass('filePath')}"
          />
        </div>
      {:else if inputMode === 'url'}
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">URL *</Label>
          <Input
            bind:value={url}
            oninput={onUrlInput}
            placeholder="{dbTypes.find((t) => t.value === dbType)?.protocol}://host:port/db"
            class="col-span-3 h-8 text-xs font-mono {errorClass('url')}"
          />
        </div>

        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">사용자명</Label>
          <Input bind:value={username} class="col-span-3 h-8 text-xs" />
        </div>

        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">비밀번호</Label>
          <Input type="password" bind:value={password} class="col-span-3 h-8 text-xs" />
        </div>
      {:else}
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">호스트 *</Label>
          <Input
            bind:value={host}
            oninput={() => clearError('host')}
            placeholder="localhost"
            class="col-span-3 h-8 text-xs {errorClass('host')}"
          />
        </div>

        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">포트 *</Label>
          <Input
            type="number"
            bind:value={port}
            oninput={() => clearError('port')}
            class="col-span-3 h-8 text-xs {errorClass('port')}"
          />
        </div>

        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">데이터베이스</Label>
          <Input bind:value={database} class="col-span-3 h-8 text-xs" />
        </div>

        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">사용자명</Label>
          <Input bind:value={username} class="col-span-3 h-8 text-xs" />
        </div>

        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">비밀번호</Label>
          <Input type="password" bind:value={password} class="col-span-3 h-8 text-xs" />
        </div>

        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">URL 미리보기</Label>
          <div class="col-span-3 rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
            {generatedUrl}
          </div>
        </div>
      {/if}
    </div>

    {#if testResult}
      <div class="rounded-md px-3 py-2 text-xs {testResult.success ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive-foreground'}">
        {testResult.message}
      </div>
    {/if}

    <Dialog.Footer class="flex items-center justify-between sm:justify-between">
      <Button variant="secondary" size="sm" onclick={handleTest} disabled={testing}>
        {#if testing}
          <Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          테스트 중...
        {:else}
          연결 테스트
        {/if}
      </Button>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={handleCancel}>취소</Button>
        <Button size="sm" onclick={handleSave} disabled={saving}>
          {#if saving}
            <Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
            저장 중...
          {:else}
            저장
          {/if}
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
