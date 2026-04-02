<script lang="ts">
  import { SquarePlus } from 'lucide-svelte'
  import ThemeToggle from './ThemeToggle.svelte'

  let { onNewTab }: { onNewTab: () => void } = $props()

  let appVersion = $state<string | null>(null)
  let updateInfo = $state<{ version: string; downloadUrl: string } | null>(null)
  let winUpdateVersion = $state<string | null>(null)
  let winUpdateReady = $state<string | null>(null)

  $effect(() => {
    window.api.getAppVersion().then((v) => { appVersion = v })
    window.api.checkUpdate().then((result) => {
      if (result?.hasUpdate) {
        updateInfo = { version: result.version, downloadUrl: result.downloadUrl }
      }
    })
    window.api.onUpdateAvailable((version) => { winUpdateVersion = version })
    window.api.onUpdateDownloaded((version) => { winUpdateReady = version; winUpdateVersion = null })
  })
</script>

{#if winUpdateReady}
  <div class="flex h-8 items-center justify-center gap-2 bg-green-500/10 px-4 text-[11px] text-green-600 dark:text-green-400">
    <span>버전 {winUpdateReady} 다운로드 완료.</span>
    <button
      class="font-medium underline underline-offset-2 hover:no-underline"
      onclick={() => window.api.installUpdate()}
    >
      지금 설치
    </button>
  </div>
{:else if winUpdateVersion}
  <div class="flex h-8 items-center justify-center gap-2 bg-blue-500/10 px-4 text-[11px] text-blue-600 dark:text-blue-400">
    <span>버전 {winUpdateVersion} 다운로드 중...</span>
  </div>
{:else if updateInfo}
  <div class="flex h-8 items-center justify-center gap-2 bg-blue-500/10 px-4 text-[11px] text-blue-600 dark:text-blue-400">
    <span>새 버전 {updateInfo.version}이 출시되었습니다.</span>
    <button
      class="font-medium underline underline-offset-2 hover:no-underline"
      onclick={() => window.api.openExternal(updateInfo!.downloadUrl)}
    >
      다운로드
    </button>
  </div>
{/if}
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
    {#if appVersion}
      <span class="select-none px-2 text-[11px] text-muted-foreground/60">v{appVersion}</span>
    {/if}
  </div>
</div>
