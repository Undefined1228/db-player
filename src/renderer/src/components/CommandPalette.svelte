<script lang="ts">
  import { tick } from 'svelte'
  import { getCommands, fuzzyMatch, type Command } from '$lib/stores/commands'

  let { open = $bindable(false) }: { open: boolean } = $props()

  let query = $state('')
  let selectedIndex = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)

  let commands = $derived(getCommands().filter((cmd) => fuzzyMatch(query, cmd.label)))

  $effect(() => {
    if (open) {
      query = ''
      selectedIndex = 0
      tick().then(() => inputEl?.focus())
    }
  })

  $effect(() => {
    if (selectedIndex >= commands.length) {
      selectedIndex = Math.max(0, commands.length - 1)
    }
  })

  function execute(cmd: Command): void {
    open = false
    cmd.action()
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = (selectedIndex + 1) % Math.max(1, commands.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = (selectedIndex - 1 + Math.max(1, commands.length)) % Math.max(1, commands.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = commands[selectedIndex]
      if (cmd) execute(cmd)
    } else if (e.key === 'Escape') {
      open = false
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
    role="dialog"
    aria-modal="true"
    aria-label="명령어 팔레트"
  >
    <div
      class="absolute inset-0 bg-black/40"
      role="button"
      tabindex="-1"
      onclick={() => (open = false)}
      onkeydown={() => {}}
      aria-label="팔레트 닫기"
    ></div>

    <div class="relative z-10 w-full max-w-lg rounded-xl border border-border bg-popover shadow-2xl overflow-hidden">
      <input
        bind:this={inputEl}
        bind:value={query}
        onkeydown={handleKeydown}
        type="text"
        placeholder="명령어 검색..."
        class="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
      />
      <div class="max-h-72 overflow-y-auto p-1">
        {#if commands.length === 0}
          <div class="px-3 py-4 text-center text-sm text-muted-foreground">명령어를 찾을 수 없습니다</div>
        {:else}
          {#each commands as cmd, i (cmd.id)}
            <button
              class="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors
                {i === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-accent/50'}"
              onclick={() => execute(cmd)}
              onmouseenter={() => (selectedIndex = i)}
            >
              <span>{cmd.label}</span>
              {#if cmd.shortcut}
                <kbd class="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border">{cmd.shortcut}</kbd>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
