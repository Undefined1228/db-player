<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { connections } from '$lib/stores/connections'
  import { tabsStore } from '$lib/stores/tabs'

  let { open = $bindable(false) }: { open: boolean } = $props()

  let selectedId = $state<number | null>(null)

  $effect(() => {
    if (open) {
      selectedId = $connections[0]?.id ?? null
    }
  })

  function handleOpen(): void {
    const conn = $connections.find((c) => c.id === selectedId)
    if (!conn) return
    tabsStore.openTab({ connectionId: conn.id, dbType: conn.dbType, title: conn.name })
    open = false
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-xs">
    <Dialog.Header>
      <Dialog.Title>새 탭</Dialog.Title>
    </Dialog.Header>
    <div class="flex flex-col gap-3 py-2">
      {#if $connections.length === 0}
        <p class="text-xs text-muted-foreground">등록된 연결이 없습니다.</p>
      {:else}
        <select
          class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          bind:value={selectedId}
        >
          {#each $connections as conn}
            <option value={conn.id}>{conn.name}</option>
          {/each}
        </select>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (open = false)}>취소</Button>
      <Button size="sm" onclick={handleOpen} disabled={selectedId === null}>열기</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
