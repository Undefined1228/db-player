<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog'
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Label } from '$lib/components/ui/label'
  import { Loader2 } from 'lucide-svelte'

  let {
    open = $bindable(false),
    connectionId,
    schemaName,
    onDropped
  }: {
    open: boolean
    connectionId: number
    schemaName: string
    onDropped: () => void
  } = $props()

  let cascade = $state(false)
  let dropping = $state(false)
  let error = $state<string | null>(null)

  $effect(() => {
    if (open) {
      cascade = false
      error = null
    }
  })

  async function handleDrop(): Promise<void> {
    dropping = true
    error = null
    try {
      await window.api.dropSchema(connectionId, schemaName, cascade)
      open = false
      onDropped()
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      dropping = false
    }
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>스키마 삭제</AlertDialog.Title>
      <AlertDialog.Description>
        "{schemaName}" 스키마를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
      </AlertDialog.Description>
    </AlertDialog.Header>

    <div class="flex items-center gap-2 py-2">
      <Checkbox id="cascade" bind:checked={cascade} />
      <Label for="cascade" class="text-xs font-normal cursor-pointer">
        포함된 모든 객체 함께 삭제 (CASCADE)
      </Label>
    </div>

    {#if cascade}
      <p class="text-[11px] text-destructive-foreground bg-destructive/10 rounded px-3 py-2">
        스키마 내의 테이블, 뷰, 함수 등 모든 객체가 함께 삭제됩니다.
      </p>
    {/if}

    {#if error}
      <p class="text-[11px] text-destructive-foreground bg-destructive/10 rounded px-3 py-2">
        {error}
      </p>
    {/if}

    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={dropping}>취소</AlertDialog.Cancel>
      <Button variant="destructive" size="sm" onclick={handleDrop} disabled={dropping}>
        {#if dropping}
          <Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          삭제 중...
        {:else}
          삭제
        {/if}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
