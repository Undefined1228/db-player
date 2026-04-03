<script lang="ts">
  import { theme, type Theme } from '$lib/stores/theme'
  import { Button } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { Sun, Moon, Monitor } from 'lucide-svelte'

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: '시스템', icon: Monitor },
    { value: 'light', label: '밝게', icon: Sun },
    { value: 'dark', label: '어둡게', icon: Moon }
  ]
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button variant="ghost" size="icon" class="h-7 w-7" {...props}>
        <Sun class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span class="sr-only">테마 변경</span>
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    {#each options as opt}
      <DropdownMenu.Item onclick={() => { console.log('테마 변경:', opt.value, '→ classList:', document.documentElement.classList.toString()); theme.set(opt.value); console.log('테마 적용 후 classList:', document.documentElement.classList.toString()); }}>
        <opt.icon class="mr-2 h-4 w-4" />
        {opt.label}
        {#if $theme === opt.value}
          <span class="ml-auto text-xs text-muted-foreground">✓</span>
        {/if}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
