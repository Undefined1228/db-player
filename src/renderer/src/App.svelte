<script lang="ts">
  import { ResizablePaneGroup, ResizablePane, ResizableHandle } from '$lib/components/ui/resizable'
  import Header from './components/layout/Header.svelte'
  import Sidebar from './components/layout/Sidebar.svelte'
  import QueryWorkspace from './components/query/QueryWorkspace.svelte'
  import NewTabDialog from './components/layout/NewTabDialog.svelte'
  import DDLDialog from './components/table/DDLDialog.svelte'
  import CommandPalette from './components/layout/CommandPalette.svelte'
  import { tabsStore } from '$lib/stores/tabs'

  const isMac = navigator.platform.toUpperCase().includes('MAC')

  let newTabDialogOpen = $state(false)
  let paletteOpen = $state(false)

  function handleKeydown(e: KeyboardEvent): void {
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && e.key === 'k') {
      e.preventDefault()
      paletteOpen = true
    }
    if (mod && e.key === 't') {
      e.preventDefault()
      newTabDialogOpen = true
    }
    if (mod && e.key === 'w') {
      e.preventDefault()
      const active = $tabsStore.activeId
      if (active) tabsStore.closeTab(active)
    }
  }

  $effect(() => {
    function onPaletteNewTab(): void {
      newTabDialogOpen = true
    }
    window.addEventListener('palette:new-tab', onPaletteNewTab)
    return () => window.removeEventListener('palette:new-tab', onPaletteNewTab)
  })

  $effect(() => {
    window.api.onMenuNewTab(() => { newTabDialogOpen = true })
    window.api.onMenuCloseTab(() => {
      const active = $tabsStore.activeId
      if (active) tabsStore.closeTab(active)
    })
  })
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen w-screen flex-col">
  <Header onNewTab={() => (newTabDialogOpen = true)} />
  <ResizablePaneGroup direction="horizontal" class="flex-1">
    <ResizablePane defaultSize={20} minSize={10} maxSize={40}>
      <Sidebar />
    </ResizablePane>
    <ResizableHandle />
    <ResizablePane defaultSize={80}>
      <QueryWorkspace />
    </ResizablePane>
  </ResizablePaneGroup>
</div>

<NewTabDialog bind:open={newTabDialogOpen} />
<DDLDialog />
<CommandPalette bind:open={paletteOpen} />
