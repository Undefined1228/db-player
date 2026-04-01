<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { ddlDialogStore } from '$lib/stores/ddl-dialog'
  import { Copy, Check, Loader2 } from 'lucide-svelte'

  let copied = $state(false)

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText($ddlDialogStore.ddl)
    copied = true
    setTimeout(() => (copied = false), 1500)
  }

  function handleClose(): void {
    ddlDialogStore.update((s) => ({ ...s, open: false }))
  }
</script>

<Dialog.Root
  open={$ddlDialogStore.open}
  onOpenChange={(v) => { if (!v) handleClose() }}
>
  <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-2xl max-h-[80vh]">
    <Dialog.Header class="px-6 pt-5 pb-4 border-b border-border">
      <Dialog.Title class="font-mono text-sm">{$ddlDialogStore.title}</Dialog.Title>
    </Dialog.Header>

    <div class="flex-1 min-h-0 overflow-hidden">
      {#if $ddlDialogStore.loading}
        <div class="flex h-40 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          <span class="text-xs">불러오는 중...</span>
        </div>
      {:else if $ddlDialogStore.error}
        <div class="px-6 py-4 text-xs text-destructive-foreground">
          {$ddlDialogStore.error}
        </div>
      {:else}
        <textarea
          readonly
          class="h-full w-full resize-none bg-muted/30 font-mono text-xs text-foreground outline-none px-6 py-4 leading-relaxed min-h-64"
          value={$ddlDialogStore.ddl}
          spellcheck={false}
        ></textarea>
      {/if}
    </div>

    <Dialog.Footer class="px-6 py-4 border-t border-border">
      <Button
        variant="outline"
        size="sm"
        class="gap-1.5"
        onclick={handleCopy}
        disabled={$ddlDialogStore.loading || !!$ddlDialogStore.error}
      >
        {#if copied}
          <Check class="h-3.5 w-3.5" />
          복사됨
        {:else}
          <Copy class="h-3.5 w-3.5" />
          클립보드 복사
        {/if}
      </Button>
      <Button size="sm" onclick={handleClose}>닫기</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
