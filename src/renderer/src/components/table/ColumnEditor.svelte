<script lang="ts">
    import { Input } from '$lib/components/ui/input'
    import { Button } from '$lib/components/ui/button'
    import { Checkbox } from '$lib/components/ui/checkbox'
    import { Trash2, GripVertical } from 'lucide-svelte'

    interface ColumnDef {
        id: string
        name: string
        type: string
        size: string
        nullable: boolean
        primaryKey: boolean
        defaultValue: string
    }

    let {
        col = $bindable(),
        idx,
        typeGroups,
        sizeTypes,
        hasError,
        canDelete,
        isNew = false,
        onTypeChange,
        onRemove,
        onTogglePrimaryKey,
        onNameInput,
    }: {
        col: ColumnDef
        idx: number
        typeGroups: { group: string; types: string[] }[]
        sizeTypes: Set<string>
        hasError: boolean
        canDelete: boolean
        isNew?: boolean
        onTypeChange: (idx: number, type: string) => void
        onRemove: (idx: number) => void
        onTogglePrimaryKey: (idx: number) => void
        onNameInput: (idx: number) => void
    } = $props()

    const selectClass = 'h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

    /** 타입에 따른 크기 입력 placeholder 반환 */
    function sizePlaceholder(type: string): string {
        if (type === 'numeric' || type === 'decimal') return '정밀도,소수점 (예: 10,2)'
        return '길이 (예: 255)'
    }
</script>

<tr class="border-b border-border last:border-0 hover:bg-muted/30 {isNew ? 'bg-green-500/5' : ''}">
    <td class="px-2 py-1.5 text-muted-foreground">
        <GripVertical class="h-3.5 w-3.5" />
    </td>
    <td class="px-2 py-1.5">
        <Input
            bind:value={col.name}
            oninput={() => onNameInput(idx)}
            placeholder="column_name"
            class="h-7 text-xs {hasError ? 'border-destructive-foreground ring-1 ring-destructive-foreground' : ''}"
        />
    </td>
    <td class="px-2 py-1.5">
        <select
            value={col.type}
            onchange={(e) => onTypeChange(idx, (e.target as HTMLSelectElement).value)}
            class={selectClass}
        >
            {#each typeGroups as group}
                <optgroup label={group.group}>
                    {#each group.types as type}
                        <option value={type}>{type}</option>
                    {/each}
                </optgroup>
            {/each}
        </select>
    </td>
    <td class="px-2 py-1.5">
        {#if sizeTypes.has(col.type)}
            <Input bind:value={col.size} placeholder={sizePlaceholder(col.type)} class="h-7 text-xs" />
        {:else}
            <span class="text-muted-foreground px-1">—</span>
        {/if}
    </td>
    <td class="px-2 py-1.5">
        <div class="flex justify-center">
            <Checkbox checked={col.primaryKey} onCheckedChange={() => onTogglePrimaryKey(idx)} />
        </div>
    </td>
    <td class="px-2 py-1.5">
        <div class="flex justify-center">
            <Checkbox bind:checked={col.nullable} disabled={col.primaryKey} />
        </div>
    </td>
    <td class="px-2 py-1.5">
        <Input bind:value={col.defaultValue} placeholder="없음" class="h-7 text-xs" />
    </td>
    <td class="px-2 py-1.5">
        <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6 text-muted-foreground hover:text-destructive-foreground"
            onclick={() => onRemove(idx)}
            disabled={!canDelete}
        >
            <Trash2 class="h-3.5 w-3.5" />
        </Button>
    </td>
</tr>
