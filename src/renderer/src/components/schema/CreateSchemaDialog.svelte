<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Select from '$lib/components/ui/select'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Loader2 } from 'lucide-svelte'

  let {
    open = $bindable(false),
    connectionId,
    onCreated
  }: {
    open: boolean
    connectionId: number
    onCreated: () => void
  } = $props()

  const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_$]*$/

  let schemaName = $state('')
  let owner = $state('')
  let roles = $state<string[]>([])
  let loadingRoles = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let nameError = $state(false)

  $effect(() => {
    if (open) {
      schemaName = ''
      owner = ''
      error = null
      nameError = false
      loadRoles()
    }
  })

  async function loadRoles(): Promise<void> {
    loadingRoles = true
    try {
      roles = await window.api.getRoles(connectionId)
    } catch {
      roles = []
    } finally {
      loadingRoles = false
    }
  }

  function validate(): boolean {
    if (!schemaName.trim()) {
      nameError = true
      return false
    }
    if (!IDENT_RE.test(schemaName)) {
      nameError = true
      return false
    }
    return true
  }

  async function handleCreate(): Promise<void> {
    if (!validate()) return
    saving = true
    error = null
    try {
      await window.api.createSchema(connectionId, schemaName.trim(), owner || undefined)
      open = false
      onCreated()
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function handleCancel(): void {
    open = false
  }

  function errorClass(hasError: boolean): string {
    return hasError ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[400px]">
    <Dialog.Header>
      <Dialog.Title>스키마 추가</Dialog.Title>
      <Dialog.Description>새 PostgreSQL 스키마를 생성합니다.</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-4 py-4">
      <div class="grid grid-cols-4 items-center gap-4">
        <Label class="text-right text-xs">스키마 이름 *</Label>
        <div class="col-span-3 flex flex-col gap-1">
          <Input
            bind:value={schemaName}
            oninput={() => (nameError = false)}
            placeholder="my_schema"
            class="h-8 text-xs {errorClass(nameError)}"
          />
          {#if nameError}
            <p class="text-[10px] text-destructive-foreground">
              영문자/밑줄로 시작하고 영문자·숫자·밑줄·$만 사용 가능합니다.
            </p>
          {/if}
        </div>
      </div>

      <div class="grid grid-cols-4 items-center gap-4">
        <Label class="text-right text-xs">소유자</Label>
        {#if loadingRoles}
          <div class="col-span-3 flex items-center gap-1.5">
            <Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span class="text-xs text-muted-foreground">로딩 중...</span>
          </div>
        {:else}
          <Select.Root type="single" value={owner} onValueChange={(v) => (owner = v ?? '')}>
            <Select.Trigger class="col-span-3 h-8 text-xs">
              {owner || '현재 사용자 (기본값)'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="" label="현재 사용자 (기본값)" />
              {#each roles as role}
                <Select.Item value={role} label={role} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
    </div>

    {#if error}
      <div class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
        {error}
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={handleCancel}>취소</Button>
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
