<script lang="ts">
  import { onDestroy } from 'svelte'
  import { RefreshCw, Activity, Lock, BarChart2, Zap, MoreHorizontal } from 'lucide-svelte'
  import * as Tabs from '$lib/components/ui/tabs'
  import * as AlertDialog from '$lib/components/ui/alert-dialog'

  let {
    connectionId,
    dbType
  }: {
    connectionId: number
    dbType: string
  } = $props()

  let activeSection = $state('sessions')
  let autoRefresh = $state(false)
  let refreshInterval = $state('10')
  let loading = $state(false)
  let error = $state<string | null>(null)

  let sessions = $state<SessionRow[]>([])
  let locks = $state<LockRow[]>([])
  let stats = $state<TableStatRow[]>([])

  let autoRefreshTimer = $state<ReturnType<typeof setInterval> | null>(null)

  let killTarget = $state<{ id: number; mode: 'cancel' | 'terminate' } | null>(null)
  let killDialogOpen = $state(false)

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  }

  function formatDuration(sec: number | null): string {
    if (sec == null) return '-'
    if (sec < 60) return `${sec}s`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  }

  function stateBadgeClass(state: string): string {
    switch (state) {
      case 'active': return 'bg-green-500/20 text-green-400'
      case 'idle': return 'bg-muted text-muted-foreground'
      case 'idle in transaction': return 'bg-yellow-500/20 text-yellow-400'
      case 'idle in transaction (aborted)': return 'bg-red-500/20 text-red-400'
      case 'fastpath function call': return 'bg-blue-500/20 text-blue-400'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  async function refresh() {
    loading = true
    error = null
    try {
      if (activeSection === 'sessions') {
        sessions = await window.api.getSessions(connectionId)
      } else if (activeSection === 'locks') {
        locks = await window.api.getLocks(connectionId)
      } else if (activeSection === 'stats') {
        stats = await window.api.getTableStats(connectionId)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh()
    autoRefreshTimer = setInterval(() => refresh(), parseInt(refreshInterval) * 1000)
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
  }

  $effect(() => {
    if (autoRefresh) {
      startAutoRefresh()
    } else {
      stopAutoRefresh()
    }
  })

  $effect(() => {
    if (autoRefresh && autoRefreshTimer) {
      startAutoRefresh()
    }
  })

  $effect(() => {
    void activeSection
    refresh()
  })

  onDestroy(() => stopAutoRefresh())

  function openKillDialog(id: number, mode: 'cancel' | 'terminate') {
    killTarget = { id, mode }
    killDialogOpen = true
  }

  async function confirmKill() {
    if (!killTarget) return
    await window.api.killSession(connectionId, killTarget.id, killTarget.mode)
    killDialogOpen = false
    killTarget = null
    await refresh()
  }
</script>

<div class="flex h-full flex-col">
  <!-- 툴바 -->
  <div class="flex shrink-0 items-center gap-3 border-b border-border bg-muted/20 px-4 py-2">
    <div class="flex items-center gap-1.5">
      <Activity class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-xs font-medium text-foreground">세션 모니터</span>
      <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono uppercase">{dbType}</span>
    </div>
    <div class="ml-auto flex items-center gap-2">
      <label class="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
        <input type="checkbox" bind:checked={autoRefresh} class="h-3 w-3 rounded" />
        자동 새로고침
      </label>
      {#if autoRefresh}
        <select
          bind:value={refreshInterval}
          class="h-6 rounded border border-input bg-background px-1.5 text-[11px] text-foreground"
        >
          <option value="5">5초</option>
          <option value="10">10초</option>
          <option value="30">30초</option>
          <option value="60">60초</option>
        </select>
      {/if}
      <button
        onclick={refresh}
        class="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        disabled={loading}
      >
        <RefreshCw class="h-3 w-3 {loading ? 'animate-spin' : ''}" />
        새로고침
      </button>
    </div>
  </div>

  {#if error}
    <div class="shrink-0 px-4 py-2 text-[11px] text-red-400 bg-red-500/10 border-b border-border">
      {error}
    </div>
  {/if}

  <!-- 섹션 탭 -->
  <Tabs.Root bind:value={activeSection} class="flex flex-1 flex-col min-h-0">
    <Tabs.List class="shrink-0 rounded-none border-b border-border bg-transparent px-4 justify-start h-9 gap-0">
      <Tabs.Trigger value="sessions" class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-full px-3 text-xs gap-1.5">
        <Zap class="h-3 w-3" />
        활성 세션
        {#if sessions.length > 0}
          <span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono">{sessions.length}</span>
        {/if}
      </Tabs.Trigger>
      <Tabs.Trigger value="locks" class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-full px-3 text-xs gap-1.5">
        <Lock class="h-3 w-3" />
        잠금 현황
        {#if locks.length > 0}
          <span class="rounded-full bg-red-500/20 text-red-400 px-1.5 py-0.5 text-[10px] font-mono">{locks.length}</span>
        {/if}
      </Tabs.Trigger>
      <Tabs.Trigger value="stats" class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-full px-3 text-xs gap-1.5">
        <BarChart2 class="h-3 w-3" />
        테이블 통계
      </Tabs.Trigger>
    </Tabs.List>

    <!-- 활성 세션 -->
    <Tabs.Content value="sessions" class="flex-1 min-h-0 overflow-auto p-0 mt-0">
      <table class="w-full text-xs border-collapse">
        <thead class="sticky top-0 bg-muted/60 backdrop-blur-sm z-10">
          <tr>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
              {dbType === 'postgresql' ? 'PID' : 'ID'}
            </th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">사용자</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">데이터베이스</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">상태</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">실행 시간</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">대기 이벤트</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground min-w-64">쿼리</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">작업</th>
          </tr>
        </thead>
        <tbody>
          {#if sessions.length === 0}
            <tr>
              <td colspan="8" class="px-3 py-12 text-center text-muted-foreground text-[11px]">
                {loading ? '불러오는 중...' : '활성 세션이 없습니다.'}
              </td>
            </tr>
          {:else}
            {#each sessions as session}
              <tr class="border-b border-border/50 hover:bg-muted/30">
                <td class="px-3 py-1.5 font-mono text-muted-foreground">{session.id}</td>
                <td class="px-3 py-1.5">{session.user || '-'}</td>
                <td class="px-3 py-1.5">{session.database || '-'}</td>
                <td class="px-3 py-1.5">
                  <span class="rounded px-1.5 py-0.5 text-[10px] font-medium {stateBadgeClass(session.state)}">
                    {session.state || '-'}
                  </span>
                </td>
                <td class="px-3 py-1.5 font-mono text-muted-foreground">{formatDuration(session.durationSec)}</td>
                <td class="px-3 py-1.5 text-muted-foreground">
                  {session.waitEventType && session.waitEvent
                    ? `${session.waitEventType}/${session.waitEvent}`
                    : session.waitEvent || '-'}
                </td>
                <td class="px-3 py-1.5 max-w-xs">
                  <span class="block truncate font-mono text-[11px] text-muted-foreground" title={session.query ?? ''}>
                    {session.query || '-'}
                  </span>
                </td>
                <td class="px-3 py-1.5">
                  <div class="flex items-center gap-1">
                    {#if session.state === 'active'}
                      <button
                        onclick={() => openKillDialog(session.id, 'cancel')}
                        class="rounded px-1.5 py-0.5 text-[10px] text-yellow-400 hover:bg-yellow-500/10"
                      >
                        쿼리 취소
                      </button>
                    {/if}
                    <button
                      onclick={() => openKillDialog(session.id, 'terminate')}
                      class="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10"
                    >
                      연결 종료
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </Tabs.Content>

    <!-- 잠금 현황 -->
    <Tabs.Content value="locks" class="flex-1 min-h-0 overflow-auto p-0 mt-0">
      <table class="w-full text-xs border-collapse">
        <thead class="sticky top-0 bg-muted/60 backdrop-blur-sm z-10">
          <tr>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
              {dbType === 'postgresql' ? '대기 PID' : '대기 ID'}
            </th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">대기 사용자</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
              {dbType === 'postgresql' ? '차단 PID' : '차단 ID'}
            </th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">차단 사용자</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">잠금 유형</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">테이블</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground min-w-48">대기 쿼리</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground min-w-48">차단 쿼리</th>
          </tr>
        </thead>
        <tbody>
          {#if locks.length === 0}
            <tr>
              <td colspan="8" class="px-3 py-12 text-center text-muted-foreground text-[11px]">
                {loading ? '불러오는 중...' : '잠금 대기 중인 세션이 없습니다.'}
              </td>
            </tr>
          {:else}
            {#each locks as lock}
              <tr class="border-b border-border/50 hover:bg-muted/30">
                <td class="px-3 py-1.5 font-mono text-red-400">{lock.waitingId}</td>
                <td class="px-3 py-1.5">{lock.waitingUser || '-'}</td>
                <td class="px-3 py-1.5 font-mono text-orange-400">{lock.blockingId}</td>
                <td class="px-3 py-1.5">{lock.blockingUser || '-'}</td>
                <td class="px-3 py-1.5">
                  <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{lock.lockType}</span>
                </td>
                <td class="px-3 py-1.5 text-muted-foreground">{lock.tableName || '-'}</td>
                <td class="px-3 py-1.5 max-w-xs">
                  <span class="block truncate font-mono text-[11px] text-muted-foreground" title={lock.waitingQuery ?? ''}>
                    {lock.waitingQuery || '-'}
                  </span>
                </td>
                <td class="px-3 py-1.5 max-w-xs">
                  <span class="block truncate font-mono text-[11px] text-muted-foreground" title={lock.blockingQuery ?? ''}>
                    {lock.blockingQuery || '-'}
                  </span>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </Tabs.Content>

    <!-- 테이블 통계 -->
    <Tabs.Content value="stats" class="flex-1 min-h-0 overflow-auto p-0 mt-0">
      <table class="w-full text-xs border-collapse">
        <thead class="sticky top-0 bg-muted/60 backdrop-blur-sm z-10">
          <tr>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">스키마</th>
            <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">테이블</th>
            <th class="border-b border-border px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">전체 크기</th>
            <th class="border-b border-border px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">테이블 크기</th>
            <th class="border-b border-border px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">인덱스 크기</th>
            <th class="border-b border-border px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">추정 행 수</th>
            {#if dbType === 'postgresql'}
              <th class="border-b border-border px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Dead Tuples</th>
              <th class="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">마지막 VACUUM</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#if stats.length === 0}
            <tr>
              <td colspan={dbType === 'postgresql' ? 8 : 6} class="px-3 py-12 text-center text-muted-foreground text-[11px]">
                {loading ? '불러오는 중...' : '테이블 통계가 없습니다.'}
              </td>
            </tr>
          {:else}
            {#each stats as row}
              <tr class="border-b border-border/50 hover:bg-muted/30">
                <td class="px-3 py-1.5 text-muted-foreground">{row.schema}</td>
                <td class="px-3 py-1.5 font-medium">{row.table}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatBytes(row.totalBytes)}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatBytes(row.tableBytes)}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatBytes(row.indexBytes)}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">{row.estimatedRows.toLocaleString()}</td>
                {#if dbType === 'postgresql'}
                  <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">
                    {row.deadTuples != null ? row.deadTuples.toLocaleString() : '-'}
                  </td>
                  <td class="px-3 py-1.5 text-muted-foreground text-[11px]">
                    {row.lastVacuum
                      ? new Date(row.lastVacuum).toLocaleString()
                      : row.lastAutovacuum
                        ? `auto: ${new Date(row.lastAutovacuum).toLocaleString()}`
                        : '-'}
                  </td>
                {/if}
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </Tabs.Content>
  </Tabs.Root>
</div>

<!-- 세션 강제 종료 확인 다이얼로그 -->
<AlertDialog.Root bind:open={killDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>
        {killTarget?.mode === 'cancel' ? '쿼리 취소' : '연결 종료'}
      </AlertDialog.Title>
      <AlertDialog.Description>
        {#if killTarget?.mode === 'cancel'}
          PID {killTarget?.id}의 실행 중인 쿼리를 취소합니다. 연결은 유지됩니다.
        {:else}
          PID {killTarget?.id}의 연결을 강제 종료합니다. 진행 중인 트랜잭션은 롤백됩니다.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>취소</AlertDialog.Cancel>
      <AlertDialog.Action onclick={confirmKill} class="bg-destructive text-destructive-foreground hover:bg-destructive/90">
        확인
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
