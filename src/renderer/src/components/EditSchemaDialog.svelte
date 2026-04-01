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
    schemaName,
    onEdited
  }: {
    open: boolean
    connectionId: number
    schemaName: string
    onEdited: () => void
  } = $props()

  const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_$]*$/

  let newName = $state('')
  let owner = $state('')
  let roles = $state<string[]>([])
  let loading = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let nameError = $state(false)

  $effect(() => {
    if (open) {
      newName = schemaName
      owner = ''
      error = null
      nameError = false
      loadData()
    }
  })

  async function loadData(): Promise<void> {
    loading = true
    try {
      const [fetchedOwner, fetchedRoles] = await Promise.all([
        window.api.getSchemaOwner(connectionId, schemaName),
        window.api.getRoles(connectionId)
      ])
      owner = fetchedOwner
      roles = fetchedRoles
    } catch {
      roles = []
    } finally {
      loading = false
    }
  }

  function validate(): boolean {
    if (!newName.trim()) { nameError = true; return false }
    if (!IDENT_RE.test(newName)) { nameError = true; return false }
    return true
  }

  async function handleSave(): Promise<void> {
    if (!validate()) return
    saving = true
    error = null
    try {
      const nameChanged = newName !== schemaName ? newName : undefined
      await window.api.alterSchema(connectionId, schemaName, nameChanged, owner || undefined)
      open = false
      onEdited()
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function errorClass(hasError: boolean): string {
    return hasError ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[400px]">
    <Dialog.Header>
      <Dialog.Title>스키마 편집</Dialog.Title>
      <Dialog.Description>"{schemaName}" 스키마의 이름과 소유자를 변경합니다.</Dialog.Description>
    </Dialog.Header>

    {#if loading}
      <div class="flex items-center justify-center py-8 gap-2">
        <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
        <span class="text-xs text-muted-foreground">로딩 중...</span>
      </div>
    {:else}
      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-xs">스키마 이름 *</Label>
          <div class="col-span-3 flex flex-col gap-1">
            <Input
              bind:value={newName}
              oninput={() => (nameError = false)}
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
          <Select.Root type="single" value={owner} onValueChange={(v) => (owner = v ?? '')}>
            <Select.Trigger class="col-span-3 h-8 text-xs">
              {owner || '선택'}
            </Select.Trigger>
            <Select.Content>
              {#each roles as role}
                <Select.Item value={role} label={role} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
    {/if}

    {#if error}
      <div class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
        {error}
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (open = false)}>취소</Button>
      <Button size="sm" onclick={handleSave} disabled={saving || loading}>
        {#if saving}
          <Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          저장 중...
        {:else}
          저장
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
