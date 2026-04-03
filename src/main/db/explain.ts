import Database from 'better-sqlite3'
import { getConnectionWithPassword } from './connection-repository'
import { buildPgConfig, buildMysqlConfig, PgClient, mysql } from './connection-utils'

export interface ExplainNode {
  nodeType: string
  cost?: number
  actualTime?: number
  rows?: number
  actualRows?: number
  loops?: number
  relation?: string
  children: ExplainNode[]
  extra: Record<string, unknown>
}

export type ExplainResult =
  | { ok: true; plan: ExplainNode; totalTime?: number }
  | { ok: false; message: string }

function normalizePgPlan(plan: Record<string, unknown>): ExplainNode {
  const subPlans = (plan['Plans'] as Record<string, unknown>[] | undefined) ?? []
  return {
    nodeType: (plan['Node Type'] as string) ?? 'Unknown',
    cost: plan['Total Cost'] as number | undefined,
    actualTime: plan['Actual Total Time'] as number | undefined,
    rows: plan['Plan Rows'] as number | undefined,
    actualRows: plan['Actual Rows'] as number | undefined,
    loops: plan['Actual Loops'] as number | undefined,
    relation: plan['Relation Name'] as string | undefined,
    children: subPlans.map((p) => normalizePgPlan(p)),
    extra: plan,
  }
}

function normalizeMysqlTable(table: Record<string, unknown>): ExplainNode {
  const costInfo = table['cost_info'] as Record<string, unknown> | undefined
  const cost = costInfo ? parseFloat((costInfo['prefix_cost'] as string) ?? '0') : undefined
  return {
    nodeType: ((table['access_type'] as string) ?? 'TABLE').toUpperCase(),
    cost,
    rows: table['rows_examined_per_scan'] as number | undefined,
    relation: table['table_name'] as string | undefined,
    children: [],
    extra: table,
  }
}

function normalizeMysqlBlock(block: Record<string, unknown>): ExplainNode {
  const costInfo = block['cost_info'] as Record<string, unknown> | undefined
  const cost = costInfo ? parseFloat((costInfo['query_cost'] as string) ?? '0') : undefined
  const children: ExplainNode[] = []
  const nestedLoop = block['nested_loop'] as Record<string, unknown>[] | undefined
  if (nestedLoop) {
    for (const item of nestedLoop) {
      if (item['table']) children.push(normalizeMysqlTable(item['table'] as Record<string, unknown>))
    }
  } else if (block['table']) {
    children.push(normalizeMysqlTable(block['table'] as Record<string, unknown>))
  }
  return { nodeType: 'Query Block', cost, children, extra: block }
}

function normalizeMariadbTable(table: Record<string, unknown>): ExplainNode {
  const cost = table['cost'] != null ? Number(table['cost']) : undefined
  return {
    nodeType: ((table['access_type'] as string) ?? 'TABLE').toUpperCase(),
    cost,
    rows: table['rows'] as number | undefined,
    relation: table['table_name'] as string | undefined,
    children: [],
    extra: table,
  }
}

function normalizeMariadbBlock(block: Record<string, unknown>): ExplainNode {
  const cost = block['cost'] != null ? Number(block['cost']) : undefined
  const children: ExplainNode[] = []
  const nestedLoop = block['nested_loop'] as Record<string, unknown>[] | undefined
  if (nestedLoop) {
    for (const item of nestedLoop) {
      if (item['table']) children.push(normalizeMariadbTable(item['table'] as Record<string, unknown>))
    }
  } else if (block['table']) {
    children.push(normalizeMariadbTable(block['table'] as Record<string, unknown>))
  }
  return { nodeType: 'Query Block', cost, children, extra: block }
}

function buildSqliteTree(rows: { id: number; parent: number; detail: string }[]): ExplainNode {
  const nodeMap = new Map<number, ExplainNode & { _id: number; _parentId: number }>()
  for (const row of rows) {
    nodeMap.set(row.id, { _id: row.id, _parentId: row.parent, nodeType: row.detail, children: [], extra: { detail: row.detail } })
  }
  const roots: (ExplainNode & { _id: number; _parentId: number })[] = []
  for (const node of nodeMap.values()) {
    if (node._parentId === 0) {
      roots.push(node)
    } else {
      const parent = nodeMap.get(node._parentId)
      if (parent) parent.children.push(node)
    }
  }
  if (roots.length === 1) return roots[0]
  return { nodeType: 'Query Plan', children: roots, extra: {} }
}

export async function explainQuery(connectionId: number, sql: string): Promise<ExplainResult> {
  const conn = getConnectionWithPassword(connectionId)
  if (!conn) return { ok: false, message: '연결 정보를 찾을 수 없습니다.' }

  switch (conn.dbType) {
    case 'postgresql': {
      let client: InstanceType<typeof PgClient> | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)
        const raw = result.rows[0]['QUERY PLAN'] as Record<string, unknown>[]
        const root = raw[0]
        const plan = normalizePgPlan(root['Plan'] as Record<string, unknown>)
        const totalTime = root['Execution Time'] as number | undefined
        return { ok: true, plan, totalTime }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      } finally {
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mysql': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        const [rows] = await connection.query(`EXPLAIN FORMAT=JSON ${sql}`)
        const raw = (rows as Record<string, unknown>[])[0]['EXPLAIN'] as string
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const block = parsed['query_block'] as Record<string, unknown>
        const plan = normalizeMysqlBlock(block)
        return { ok: true, plan }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    case 'mariadb': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        const [rows] = await connection.query(`EXPLAIN FORMAT=JSON ${sql}`)
        const raw = (rows as Record<string, unknown>[])[0]['EXPLAIN'] as string
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const block = parsed['query_block'] as Record<string, unknown>
        const plan = normalizeMariadbBlock(block)
        return { ok: true, plan }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    case 'sqlite': {
      const filePath = conn.filePath
      if (!filePath) return { ok: false, message: 'SQLite 파일 경로가 없습니다.' }
      const db = new Database(filePath)
      try {
        const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { id: number; parent: number; notused: number; detail: string }[]
        const plan = buildSqliteTree(rows)
        return { ok: true, plan }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      } finally {
        db.close()
      }
    }
    default:
      return { ok: false, message: '지원하지 않는 DB 유형입니다.' }
  }
}
