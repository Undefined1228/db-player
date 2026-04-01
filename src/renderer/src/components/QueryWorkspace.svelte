<script lang="ts">
  import { Terminal, X } from 'lucide-svelte'
  import { tick } from 'svelte'
  import { tabsStore } from '$lib/stores/tabs'
  import { DbIcon } from './icons'
  import DataViewerTab from './DataViewerTab.svelte'
  import QueryEditor from './QueryEditor.svelte'
  import ErDiagramTab from './ErDiagramTab.svelte'

  const isMac = navigator.platform.toUpperCase().includes('MAC')
  const modKey = isMac ? '⌘' : 'Ctrl'

  let state = $derived($tabsStore)
  let activeTab = $derived(state.tabs.find((t) => t.id === state.activeId) ?? null)

  $effect(() => {
    const id = state.activeId
    if (!id) return
    tick().then(() => {
      document.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    })
  })

  function handleTabClick(id: string): void {
    tabsStore.setActiveTab(id)
  }

  function handleClose(e: MouseEvent, id: string): void {
    e.stopPropagation()
    tabsStore.closeTab(id)
  }

</script>

{#if state.tabs.length === 0}
  <div class="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground select-none">
    <div class="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
      <Terminal class="h-6 w-6 opacity-40" />
    </div>
    <div class="flex flex-col items-center gap-1.5 text-center">
      <p class="text-sm font-medium text-foreground/60">쿼리 에디터</p>
      <p class="text-xs text-muted-foreground/70 max-w-56 leading-relaxed">
        왼쪽 사이드바에서 연결을 선택하거나<br />새 쿼리 탭을 열어 시작하세요.
      </p>
    </div>
    <div class="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5">
      <kbd class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border">{modKey}</kbd>
      <kbd class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border">T</kbd>
      <span class="text-[11px] text-muted-foreground/60 ml-0.5">새 탭</span>
    </div>
  </div>
{:else}
  <div class="flex h-full flex-col">
    <!-- 탭 바 -->
    <div class="flex shrink-0 items-stretch border-b border-border bg-muted/30 overflow-x-auto">
      {#each state.tabs as tab (tab.id)}
        {@const isActive = tab.id === state.activeId}
        <div
          role="tab"
          tabindex="0"
          aria-selected={isActive}
          data-tab-id={tab.id}
          class="group flex items-center gap-1.5 border-r border-border px-3 py-2 text-xs transition-colors min-w-0 shrink-0 cursor-default
            {isActive
              ? 'bg-background text-foreground border-b border-b-background -mb-px'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
          onclick={() => handleTabClick(tab.id)}
          onkeydown={(e) => e.key === 'Enter' && handleTabClick(tab.id)}
        >
          <DbIcon dbType={tab.dbType} class="h-3 w-3 shrink-0 opacity-60" />
          <span class="max-w-32 truncate">{tab.title}</span>
          <button
            class="ml-0.5 rounded p-0.5 opacity-40 hover:opacity-100 hover:bg-muted transition-opacity"
            onclick={(e) => handleClose(e, tab.id)}
            aria-label="탭 닫기"
          >
            <X class="h-2.5 w-2.5" />
          </button>
        </div>
      {/each}
    </div>

    <!-- 에디터 영역 -->
    {#if activeTab}
      {#key activeTab.id}
        <div class="flex-1 min-h-0">
          {#if activeTab.type === 'data' && activeTab.schemaName && activeTab.objectName}
            <DataViewerTab
              connectionId={activeTab.connectionId}
              dbType={activeTab.dbType}
              schemaName={activeTab.schemaName}
              objectName={activeTab.objectName}
              objectType={activeTab.objectType ?? 'table'}
            />
          {:else if activeTab.type === 'erd' && activeTab.schemaName}
            <ErDiagramTab
              connectionId={activeTab.connectionId}
              schemaName={activeTab.schemaName}
            />
          {:else}
            <QueryEditor
              connectionId={activeTab.connectionId}
              dbType={activeTab.dbType}
              schemaName={activeTab.schemaName}
              query={activeTab.query}
              onQueryChange={(value) => tabsStore.updateQuery(activeTab!.id, value)}
            />
          {/if}
        </div>
      {/key}
    {/if}
  </div>
{/if}
