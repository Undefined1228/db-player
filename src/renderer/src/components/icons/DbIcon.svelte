<script lang="ts">
  import { Database } from 'lucide-svelte'
  import mysqlIcon from './ic_db_mysql.png'
  import postgresqlIcon from './ic_db_postgresql.png'

  let { dbType, class: className = '' }: { dbType: string; class?: string } = $props()

  const iconMap: Record<string, string> = {
    mysql: mysqlIcon,
    postgresql: postgresqlIcon
  }

  const icon = $derived(iconMap[dbType])
</script>

{#if icon}
  <img src={icon} alt={dbType} class={className} />
{:else}
  <Database class="{className} text-muted-foreground" />
{/if}
