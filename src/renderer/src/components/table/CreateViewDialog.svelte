<script lang="ts">
  import { untrack } from 'svelte'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Loader2 } from 'lucide-svelte'
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
  import { EditorState, Compartment } from '@codemirror/state'
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
  import { sql, PostgreSQL } from '@codemirror/lang-sql'
  import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
  import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
  import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
  import { theme } from '$lib/stores/theme'

  let {
    open = $bindable(false),
    connectionId,
    schemaName,
    editViewName = undefined,
    onSaved
  }: {
    open: boolean
    connectionId: number
    schemaName: string
    editViewName?: string
    onSaved: () => void
  } = $props()

  const isEdit = $derived(editViewName !== undefined)

  let viewName = $state('')
  let selectQuery = $state('')
  let viewNameError = $state(false)
  let queryError = $state(false)
  let saving = $state(false)
  let loading = $state(false)
  let error = $state<string | null>(null)

  let editorContainer = $state<HTMLDivElement | null>(null)
  let view: EditorView | undefined

  const highlightCompartment = new Compartment()
  const sqlCompartment = new Compartment()

  function isDark(): boolean {
    const t = $theme
    if (t === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
    return t === 'dark'
  }

  const baseTheme = EditorView.theme({
    '&': { height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: '12px',
      lineHeight: '1.6',
    },
    '.cm-content': { padding: '8px 12px' },
    '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
    '.cm-activeLine': { backgroundColor: 'hsl(var(--muted) / 0.3)' },
    '.cm-selectionBackground': { backgroundColor: 'hsl(var(--primary) / 0.2) !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'hsl(var(--primary) / 0.2) !important' },
    '.cm-gutters': {
      backgroundColor: 'hsl(var(--background))',
      borderRight: '1px solid hsl(var(--border))',
      color: 'hsl(var(--muted-foreground) / 0.5)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'hsl(var(--muted) / 0.4)',
      color: 'hsl(var(--muted-foreground) / 0.8)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '28px' },
    '.cm-tooltip': {
      border: '1px solid hsl(var(--border))',
      backgroundColor: 'hsl(var(--popover))',
      borderRadius: '6px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete ul': { padding: '4px', margin: '0', maxHeight: '200px', overflow: 'auto' },
    '.cm-tooltip-autocomplete ul li': {
      padding: '4px 10px',
      borderRadius: '4px',
      fontSize: '12px',
      color: 'hsl(var(--popover-foreground))',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'hsl(var(--primary))',
      color: 'hsl(var(--primary-foreground))',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': {
      color: 'hsl(var(--primary-foreground) / 0.7)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionMatchedText': {
      color: 'hsl(var(--primary-foreground))',
      fontWeight: '700',
    },
    '.cm-completionLabel': { fontSize: '12px' },
    '.cm-completionDetail': {
      fontSize: '11px',
      color: 'hsl(var(--muted-foreground))',
      marginLeft: '4px',
      fontStyle: 'italic',
    },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      fontWeight: '600',
      color: 'hsl(var(--primary))',
    },
  })

  function buildHighlightExtension() {
    return syntaxHighlighting(isDark() ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true })
  }

  function buildSqlExtension(schemaMap: Record<string, string[]> = {}) {
    return sql({ dialect: PostgreSQL, schema: schemaMap, upperCaseKeywords: true })
  }

  $effect(() => {
    const container = editorContainer
    if (!container) return

    const v = new EditorView({
      state: EditorState.create({
        doc: untrack(() => selectQuery),
        extensions: [
          history(),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          baseTheme,
          autocompletion({ activateOnTyping: true, activateOnTypingDelay: 0, interactionDelay: 0, maxRenderedOptions: 15 }),
          highlightCompartment.of(buildHighlightExtension()),
          sqlCompartment.of(buildSqlExtension()),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              selectQuery = update.state.doc.toString()
              queryError = false
            }
          }),
        ],
      }),
      parent: container,
    })
    view = v

    window.api.getCompletionSchema(connectionId, schemaName)
      .then((schemaMap) => { v.dispatch({ effects: sqlCompartment.reconfigure(buildSqlExtension(schemaMap)) }) })
      .catch(() => {})

    return () => {
      v.destroy()
      view = undefined
    }
  })

  $effect(() => {
    const _ = $theme
    if (view) {
      view.dispatch({ effects: highlightCompartment.reconfigure(buildHighlightExtension()) })
    }
  })

  $effect(() => {
    const q = selectQuery
    if (view) {
      const current = view.state.doc.toString()
      if (current !== q) {
        view.dispatch({ changes: { from: 0, to: current.length, insert: q } })
      }
    }
  })

  $effect(() => {
    if (open) {
      viewName = editViewName ?? ''
      selectQuery = ''
      viewNameError = false
      queryError = false
      error = null

      if (editViewName) {
        loadViewDefinition()
      }
    }
  })

  async function loadViewDefinition(): Promise<void> {
    loading = true
    try {
      const ddl = await window.api.getObjectDDL(connectionId, schemaName, editViewName!, 'view')
      const prefix = `CREATE OR REPLACE VIEW "${schemaName}"."${editViewName}" AS\n`
      selectQuery = ddl.startsWith(prefix) ? ddl.slice(prefix.length) : ddl
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function validate(): boolean {
    let valid = true
    if (!viewName.trim() || !/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(viewName.trim())) {
      viewNameError = true
      valid = false
    }
    if (!selectQuery.trim()) {
      queryError = true
      valid = false
    }
    return valid
  }

  async function handleSave(): Promise<void> {
    if (!validate()) return
    saving = true
    error = null
    try {
      if (isEdit) {
        const newName = viewName.trim() !== editViewName ? viewName.trim() : undefined
        await window.api.alterView(connectionId, schemaName, editViewName!, newName, selectQuery.trim())
      } else {
        await window.api.createView(connectionId, schemaName, viewName.trim(), selectQuery.trim())
      }
      open = false
      onSaved()
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-2xl max-h-[90vh]">
    <Dialog.Header class="px-6 pt-6 pb-4 border-b border-border">
      <Dialog.Title>{isEdit ? '뷰 수정' : '뷰 생성'}</Dialog.Title>
      <Dialog.Description>
        <span class="font-mono text-xs">{schemaName}</span> 스키마의 뷰를 {isEdit ? '수정' : '생성'}합니다.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 min-h-0">
      {#if loading}
        <div class="flex items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          <span class="text-xs">뷰 정의 로딩 중...</span>
        </div>
      {:else}
        <div class="flex items-center gap-4">
          <Label class="w-20 shrink-0 text-right text-xs">뷰 이름 *</Label>
          <div class="flex flex-col gap-1 flex-1">
            <Input
              bind:value={viewName}
              oninput={() => (viewNameError = false)}
              placeholder="my_view"
              class="h-8 text-xs {viewNameError ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''}"
            />
            {#if viewNameError}
              <p class="text-[10px] text-destructive-foreground">영문자/밑줄로 시작하고 영문자·숫자·밑줄·$만 사용 가능합니다.</p>
            {/if}
          </div>
        </div>

        <div class="flex flex-col gap-1.5 flex-1">
          <div class="flex items-center gap-2">
            <Label class="text-xs">SELECT 쿼리 *</Label>
            {#if queryError}
              <span class="text-[10px] text-destructive-foreground">쿼리를 입력하세요.</span>
            {/if}
          </div>
          <div class="rounded-md border border-input bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground font-mono select-none">
            CREATE OR REPLACE VIEW <span class="text-foreground">{schemaName}.{viewName || '<뷰 이름>'}</span> AS
          </div>
          <div
            class="rounded-md border overflow-hidden {queryError ? 'border-destructive-foreground' : 'border-input'}"
            style="height: 260px;"
          >
            <div bind:this={editorContainer} class="h-full bg-background"></div>
          </div>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="mx-6 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
        {error}
      </div>
    {/if}

    <Dialog.Footer class="px-6 py-4 border-t border-border">
      <Button variant="outline" size="sm" onclick={() => (open = false)} disabled={saving || loading}>취소</Button>
      <Button size="sm" onclick={handleSave} disabled={saving || loading}>
        {#if saving}
          <Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {isEdit ? '수정 중...' : '생성 중...'}
        {:else}
          {isEdit ? '수정' : '생성'}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
