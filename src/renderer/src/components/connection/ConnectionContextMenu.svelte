<script lang="ts">
  import * as ContextMenu from '$lib/components/ui/context-menu'
  import type { Snippet } from 'svelte'

  interface Props {
    level: 'connection' | 'schema'
    dbType: string
    children: Snippet
    onOpenEditor: () => void
    onRefresh: () => void
    onEdit: () => void
    onDelete: () => void
    onCreate: () => void
    onCreateSchema: () => void
    onOpenErDiagram?: () => void
    onMonitor?: () => void
  }

  let { level, dbType, children, onOpenEditor, onRefresh, onEdit, onDelete, onCreate, onCreateSchema, onOpenErDiagram, onMonitor }: Props = $props()
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class="w-48">
    {#if level === 'schema'}
      <ContextMenu.Item onclick={onOpenEditor}>SQL 편집기 열기</ContextMenu.Item>
      <ContextMenu.Item onclick={onCreate}>테이블 생성</ContextMenu.Item>
      {#if dbType === 'postgresql' && onOpenErDiagram}
        <ContextMenu.Item onclick={onOpenErDiagram}>ER 다이어그램 보기</ContextMenu.Item>
      {/if}
      {#if dbType === 'postgresql'}
        <ContextMenu.Separator />
        <ContextMenu.Item onclick={onEdit}>스키마 편집</ContextMenu.Item>
      {/if}
      <ContextMenu.Item onclick={onRefresh}>새로고침</ContextMenu.Item>
      {#if dbType === 'postgresql'}
        <ContextMenu.Separator />
        <ContextMenu.Item onclick={onDelete} class="text-destructive focus:text-destructive">
          스키마 삭제
        </ContextMenu.Item>
      {/if}
    {/if}
    {#if level === 'connection'}
      <ContextMenu.Item onclick={onOpenEditor}>SQL 편집기 열기</ContextMenu.Item>
      {#if dbType === 'postgresql'}
        <ContextMenu.Item onclick={onCreateSchema}>스키마 추가</ContextMenu.Item>
      {/if}
      {#if onMonitor && dbType !== 'sqlite'}
        <ContextMenu.Item onclick={onMonitor}>세션 모니터</ContextMenu.Item>
      {/if}
      <ContextMenu.Separator />
      <ContextMenu.Item onclick={onEdit}>연결 편집</ContextMenu.Item>
      <ContextMenu.Item onclick={onRefresh}>새로고침</ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item onclick={onDelete} class="text-destructive focus:text-destructive">
        연결 삭제
      </ContextMenu.Item>
    {/if}
  </ContextMenu.Content>
</ContextMenu.Root>
