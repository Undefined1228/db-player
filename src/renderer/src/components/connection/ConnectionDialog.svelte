<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Select from '$lib/components/ui/select'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Loader2, ClipboardPaste } from 'lucide-svelte'
  import { loadConnections } from '$lib/stores/connections'

  let {
    open = $bindable(false),
    initialData = null
  }: {
    open: boolean
    initialData?: ConnectionWithPassword | null
  } = $props()

  type DbType = 'mysql' | 'mariadb' | 'postgresql' | 'sqlite'
  type InputMode = 'fields' | 'url'

  const dbTypes: { value: DbType; label: string; defaultPort: number; protocol: string }[] = [
    { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432, protocol: 'postgresql' },
    { value: 'mysql', label: 'MySQL', defaultPort: 3306, protocol: 'mysql' },
    { value: 'mariadb', label: 'MariaDB', defaultPort: 3306, protocol: 'mysql' }
  ]

  let name = $state('')
  let dbType = $state<DbType>('postgresql')
  let inputMode = $state<InputMode>('fields')
  let host = $state('localhost')
  let port = $state(5432)
  let database = $state('')
  let username = $state('')
  let password = $state('')
  let filePath = $state('')
  let url = $state('')

  let sshEnabled = $state(false)
  let sshHost = $state('')
  let sshPort = $state(22)
  let sshUsername = $state('')
  let sshAuthMethod = $state<'password' | 'key'>('password')
  let sshPassword = $state('')
  let sshPrivateKey = $state('')
  let sshPassphrase = $state('')

  let errors = $state<Set<string>>(new Set())
  let testing = $state(false)
  let saving = $state(false)
  let testResult = $state<{ success: boolean; message: string } | null>(null)
  let pasteError = $state('')

  function resetForm(): void {
    name = ''
    dbType = 'postgresql'
    inputMode = 'fields'
    host = 'localhost'
    port = 5432
    database = ''
    username = ''
    password = ''
    filePath = ''
    url = ''
    sshEnabled = false
    sshHost = ''
    sshPort = 22
    sshUsername = ''
    sshAuthMethod = 'password'
    sshPassword = ''
    sshPrivateKey = ''
    sshPassphrase = ''
    errors = new Set()
    testResult = null
    pasteError = ''
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
    sshEnabled = (data as any).sshEnabled ?? false
    sshHost = (data as any).sshHost ?? ''
    sshPort = (data as any).sshPort ?? 22
    sshUsername = (data as any).sshUsername ?? ''
    sshAuthMethod = ((data as any).sshAuthMethod ?? 'password') as 'password' | 'key'
    sshPassword = (data as any).sshPassword ?? ''
    sshPrivateKey = (data as any).sshPrivateKey ?? ''
    sshPassphrase = (data as any).sshPassphrase ?? ''
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
      dbType = found.value
    }
  }

  function parseJdbcUrl(raw: string): boolean {
    const cleaned = raw.trim().replace(/^jdbc:/i, '')
    const match = cleaned.match(/^(\w+):\/\/(?:([^:@]+)(?::([^@]*))?@)?([^/:?]+)(?::(\d+))?(\/[^?]*)?(?:\?(.*))?/)
    if (!match) return false
    const protocol = match[1].toLowerCase()
    const found = dbTypes.find((t) => t.protocol === protocol || t.value === protocol)
    if (!found) return false
    dbType = found.value
    host = match[4] ?? 'localhost'
    port = match[5] ? Number(match[5]) : found.defaultPort
    database = match[6] ? match[6].replace(/^\//, '') : ''

    const params = new URLSearchParams(match[7] ?? '')
    const urlUser = match[2] ? decodeURIComponent(match[2]) : undefined
    const urlPass = match[3] ? decodeURIComponent(match[3]) : undefined
    const paramUser = params.get('user') ?? params.get('username') ?? undefined
    const paramPass = params.get('password') ?? undefined

    if (urlUser) username = urlUser
    else if (paramUser) username = paramUser
    if (urlPass) password = urlPass
    else if (paramPass) password = paramPass

    inputMode = 'fields'
    errors = new Set()
    testResult = null
    return true
  }

  function parseDataGripXml(text: string): boolean {
    const jdbcUrlMatch = text.match(/<jdbc-url>(.*?)<\/jdbc-url>/)
    if (!jdbcUrlMatch) return false
    const ok = parseJdbcUrl(jdbcUrlMatch[1])
    if (!ok) return false
    const userMatch = text.match(/<user-name>(.*?)<\/user-name>/)
    if (userMatch) username = userMatch[1]
    const nameMatch = text.match(/<data-source[^>]+name="([^"]+)"/)
    if (nameMatch) name = nameMatch[1]
    return true
  }

  async function handlePasteFromClipboard(): Promise<void> {
    pasteError = ''
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        pasteError = '클립보드가 비어 있습니다.'
        return
      }
      const ok = text.includes('<jdbc-url>') ? parseDataGripXml(text) : parseJdbcUrl(text)
      if (!ok) {
        pasteError = '지원하지 않는 형식입니다. (DataGrip 데이터소스 복사 또는 JDBC URL)'
      }
    } catch {
      pasteError = '클립보드 읽기 권한이 없습니다.'
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

    if (sshEnabled) {
      if (!sshHost.trim()) newErrors.add('sshHost')
      if (!sshUsername.trim()) newErrors.add('sshUsername')
      if (sshAuthMethod === 'password' && !sshPassword) newErrors.add('sshPassword')
      if (sshAuthMethod === 'key' && !sshPrivateKey.trim()) newErrors.add('sshPrivateKey')
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
      url: url || undefined,
      sshEnabled: sshEnabled || undefined,
      sshHost: sshEnabled ? sshHost || undefined : undefined,
      sshPort: sshEnabled ? sshPort || undefined : undefined,
      sshUsername: sshEnabled ? sshUsername || undefined : undefined,
      sshAuthMethod: sshEnabled ? sshAuthMethod : undefined,
      sshPassword: sshEnabled && sshAuthMethod === 'password' ? sshPassword || undefined : undefined,
      sshPrivateKey: sshEnabled && sshAuthMethod === 'key' ? sshPrivateKey || undefined : undefined,
      sshPassphrase: sshEnabled && sshAuthMethod === 'key' ? sshPassphrase || undefined : undefined
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
        <Label class="text-right text-xs text-muted-foreground">DataGrip</Label>
        <div class="col-span-3 flex flex-col gap-1">
          <Button variant="outline" size="sm" class="h-7 w-fit gap-1.5 text-xs" onclick={handlePasteFromClipboard}>
            <ClipboardPaste class="h-3.5 w-3.5" />
            클립보드에서 가져오기
          </Button>
          {#if pasteError}
            <p class="text-xs text-destructive-foreground">{pasteError}</p>
          {/if}
        </div>
      </div>

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

      {#if !isSqlite}
        <div class="border-t border-border pt-3 mt-1">
          <div class="grid grid-cols-4 items-center gap-4">
            <Label class="text-right text-xs">SSH 터널</Label>
            <div class="col-span-3 flex items-center gap-2">
              <Checkbox bind:checked={sshEnabled} id="ssh-enabled" />
              <Label for="ssh-enabled" class="text-xs font-normal cursor-pointer">SSH 터널링 사용</Label>
            </div>
          </div>

          {#if sshEnabled}
            <div class="mt-3 grid gap-3 rounded-md border border-border bg-muted/30 p-3">
              <div class="grid grid-cols-4 items-center gap-4">
                <Label class="text-right text-xs">SSH 호스트 *</Label>
                <Input
                  bind:value={sshHost}
                  oninput={() => clearError('sshHost')}
                  placeholder="ssh.example.com"
                  class="col-span-3 h-8 text-xs {errorClass('sshHost')}"
                />
              </div>

              <div class="grid grid-cols-4 items-center gap-4">
                <Label class="text-right text-xs">SSH 포트</Label>
                <Input
                  type="number"
                  bind:value={sshPort}
                  class="col-span-3 h-8 text-xs"
                />
              </div>

              <div class="grid grid-cols-4 items-center gap-4">
                <Label class="text-right text-xs">SSH 사용자명 *</Label>
                <Input
                  bind:value={sshUsername}
                  oninput={() => clearError('sshUsername')}
                  placeholder="ubuntu"
                  class="col-span-3 h-8 text-xs {errorClass('sshUsername')}"
                />
              </div>

              <div class="grid grid-cols-4 items-center gap-4">
                <Label class="text-right text-xs">인증 방식</Label>
                <RadioGroup value={sshAuthMethod} onValueChange={(v) => { if (v) sshAuthMethod = v as 'password' | 'key' }} class="col-span-3 flex gap-4">
                  <div class="flex items-center gap-1.5">
                    <RadioGroupItem value="password" id="ssh-auth-password" />
                    <Label for="ssh-auth-password" class="text-xs font-normal">비밀번호</Label>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <RadioGroupItem value="key" id="ssh-auth-key" />
                    <Label for="ssh-auth-key" class="text-xs font-normal">개인키</Label>
                  </div>
                </RadioGroup>
              </div>

              {#if sshAuthMethod === 'password'}
                <div class="grid grid-cols-4 items-center gap-4">
                  <Label class="text-right text-xs">SSH 비밀번호 *</Label>
                  <Input
                    type="password"
                    bind:value={sshPassword}
                    oninput={() => clearError('sshPassword')}
                    class="col-span-3 h-8 text-xs {errorClass('sshPassword')}"
                  />
                </div>
              {:else}
                <div class="grid grid-cols-4 items-start gap-4">
                  <Label class="text-right text-xs pt-2">개인키 *</Label>
                  <textarea
                    bind:value={sshPrivateKey}
                    oninput={() => clearError('sshPrivateKey')}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                    rows={5}
                    class="col-span-3 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring {errorClass('sshPrivateKey')}"
                  ></textarea>
                </div>

                <div class="grid grid-cols-4 items-center gap-4">
                  <Label class="text-right text-xs">키 패스프레이즈</Label>
                  <Input
                    type="password"
                    bind:value={sshPassphrase}
                    placeholder="(선택사항)"
                    class="col-span-3 h-8 text-xs"
                  />
                </div>
              {/if}
            </div>
          {/if}
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
