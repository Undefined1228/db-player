<script lang="ts">
  import { SquarePlus } from 'lucide-svelte'
  import ThemeToggle from './ThemeToggle.svelte'

  let { onNewTab }: { onNewTab: () => void } = $props()
</script>

<div class="flex h-10 items-center justify-between border-b border-border bg-background px-2">
  <div class="flex items-center gap-1">
    <slot />
  </div>
  <div class="flex items-center gap-1">
    <button
      class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      onclick={onNewTab}
      title="SQL 에디터 열기"
    >
      <SquarePlus class="h-3.5 w-3.5" />
      New Query
    </button>
    <ThemeToggle />
  </div>
</div>
