<script lang="ts">
  import * as ContextMenu from '$lib/components/ui/context-menu'
  import type { Snippet } from 'svelte'

  interface Props {
    objectType: 'table' | 'view' | 'matview' | 'function'
    dbType: string
    children: Snippet
    onSelectData: () => void
    onOpenEditor: () => void
    onViewDDL: () => void
    onDrop: () => void
    onRefresh: () => void
    onAlter?: () => void
    onCopyDDL?: () => void
  }

  let { objectType, dbType, children, onSelectData, onOpenEditor, onViewDDL, onDrop, onRefresh, onAlter, onCopyDDL }: Props =
    $props()

  const ddlLabel = objectType === 'function' ? '함수 정의 보기' : 'DDL 보기'
  const dropLabel =
    objectType === 'table'
      ? '테이블 삭제'
      : objectType === 'function'
        ? '함수 삭제'
        : objectType === 'matview'
          ? '구체화된 뷰 삭제'
          : '뷰 삭제'
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class="w-48">
    {#if objectType !== 'function'}
      <ContextMenu.Item onclick={onSelectData}>데이터 조회</ContextMenu.Item>
    {/if}
    <ContextMenu.Item onclick={onOpenEditor}>SQL 편집기 열기</ContextMenu.Item>

    <ContextMenu.Separator />
    <ContextMenu.Item onclick={onViewDDL}>{ddlLabel}</ContextMenu.Item>
    {#if onCopyDDL}
      <ContextMenu.Item onclick={onCopyDDL}>DDL 복사</ContextMenu.Item>
    {/if}

    {#if objectType === 'table' && onAlter || objectType === 'table' || (objectType === 'matview' && dbType === 'postgresql')}
      <ContextMenu.Separator />
      {#if objectType === 'table' && onAlter}
        <ContextMenu.Item onclick={onAlter}>테이블 수정</ContextMenu.Item>
      {/if}
      {#if objectType === 'table' || (objectType === 'matview' && dbType === 'postgresql')}
        <ContextMenu.Item onclick={onRefresh}>새로고침</ContextMenu.Item>
      {/if}
    {/if}

    <ContextMenu.Separator />
    <ContextMenu.Item onclick={onDrop} class="text-destructive focus:text-destructive">
      {dropLabel}
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
