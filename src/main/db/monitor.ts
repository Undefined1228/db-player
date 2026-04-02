import { getConnWithSsh, buildPgConfig, buildMysqlConfig, PgClient, mysql } from './connection-utils'

export interface SessionRow {
  id: number
  user: string
  database: string
  state: string
  waitEventType: string | null
  waitEvent: string | null
  durationSec: number | null
  query: string | null
}

export async function getSessions(connectionId: number): Promise<SessionRow[]> {
  const conn = await getConnWithSsh(connectionId)
  switch (conn.dbType) {
    case 'postgresql': {
      let client: InstanceType<typeof PgClient> | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        const res = await client.query(`
          SELECT pid, usename, datname, state, wait_event_type, wait_event,
                 EXTRACT(EPOCH FROM (now() - query_start))::int AS duration_sec,
                 query
          FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
          ORDER BY query_start ASC NULLS LAST
        `)
        return res.rows.map((r) => ({
          id: r.pid,
          user: r.usename ?? '',
          database: r.datname ?? '',
          state: r.state ?? '',
          waitEventType: r.wait_event_type ?? null,
          waitEvent: r.wait_event ?? null,
          durationSec: r.duration_sec != null ? Number(r.duration_sec) : null,
          query: r.query ?? null,
        }))
      } finally {
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        const [rows] = await connection.query(`
          SELECT ID, USER, DB, COMMAND, TIME, STATE, INFO AS query
          FROM information_schema.PROCESSLIST
          WHERE ID <> CONNECTION_ID()
          ORDER BY TIME DESC
        `)
        return (rows as Record<string, unknown>[]).map((r) => ({
          id: Number(r['ID']),
          user: String(r['USER'] ?? ''),
          database: String(r['DB'] ?? ''),
          state: String(r['COMMAND'] ?? ''),
          waitEventType: null,
          waitEvent: r['STATE'] ? String(r['STATE']) : null,
          durationSec: r['TIME'] != null ? Number(r['TIME']) : null,
          query: r['query'] ? String(r['query']) : null,
        }))
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    default:
      return []
  }
}

export async function killSession(
  connectionId: number,
  sessionId: number,
  mode: 'cancel' | 'terminate'
): Promise<{ success: boolean }> {
  const conn = await getConnWithSsh(connectionId)
  switch (conn.dbType) {
    case 'postgresql': {
      let client: InstanceType<typeof PgClient> | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        const fn = mode === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'
        await client.query(`SELECT ${fn}($1)`, [sessionId])
        return { success: true }
      } catch {
        return { success: false }
      } finally {
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        const sql = mode === 'cancel' ? `KILL QUERY ${sessionId}` : `KILL ${sessionId}`
        await connection.query(sql)
        return { success: true }
      } catch {
        return { success: false }
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    default:
      return { success: false }
  }
}

export interface LockRow {
  waitingId: number
  waitingUser: string
  blockingId: number
  blockingUser: string
  lockType: string
  tableName: string | null
  waitingQuery: string | null
  blockingQuery: string | null
}

export async function getLocks(connectionId: number): Promise<LockRow[]> {
  const conn = await getConnWithSsh(connectionId)
  switch (conn.dbType) {
    case 'postgresql': {
      let client: InstanceType<typeof PgClient> | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        const res = await client.query(`
          SELECT
            blocked_locks.pid AS waiting_pid,
            blocked_activity.usename AS waiting_user,
            blocking_locks.pid AS blocking_pid,
            blocking_activity.usename AS blocking_user,
            blocked_locks.locktype,
            blocked_activity.query AS waiting_query,
            blocking_activity.query AS blocking_query,
            CASE WHEN blocked_locks.relation IS NOT NULL THEN blocked_locks.relation::regclass::text ELSE NULL END AS table_name
          FROM pg_catalog.pg_locks blocked_locks
          JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
          JOIN pg_catalog.pg_locks blocking_locks
            ON blocking_locks.locktype = blocked_locks.locktype
            AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
            AND blocking_locks.granted
            AND blocking_locks.pid != blocked_locks.pid
          JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
          WHERE NOT blocked_locks.granted
        `)
        return res.rows.map((r) => ({
          waitingId: r.waiting_pid,
          waitingUser: r.waiting_user ?? '',
          blockingId: r.blocking_pid,
          blockingUser: r.blocking_user ?? '',
          lockType: r.locktype ?? '',
          tableName: r.table_name ?? null,
          waitingQuery: r.waiting_query ?? null,
          blockingQuery: r.blocking_query ?? null,
        }))
      } finally {
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        const [rows] = await connection.query(`
          SELECT
            r.trx_id AS waiting_id,
            r.trx_mysql_thread_id AS waiting_pid,
            b.trx_id AS blocking_id,
            b.trx_mysql_thread_id AS blocking_pid,
            r.trx_query AS waiting_query,
            b.trx_query AS blocking_query
          FROM information_schema.INNODB_TRX r
          JOIN information_schema.INNODB_TRX b
            ON b.trx_id = (
              SELECT blocking_trx_id FROM performance_schema.data_lock_waits
              WHERE requesting_engine_transaction_id = r.trx_id LIMIT 1
            )
          WHERE r.trx_state = 'LOCK WAIT'
        `)
        return (rows as Record<string, unknown>[]).map((r) => ({
          waitingId: Number(r['waiting_pid']),
          waitingUser: '',
          blockingId: Number(r['blocking_pid']),
          blockingUser: '',
          lockType: 'RECORD',
          tableName: null,
          waitingQuery: r['waiting_query'] ? String(r['waiting_query']) : null,
          blockingQuery: r['blocking_query'] ? String(r['blocking_query']) : null,
        }))
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    default:
      return []
  }
}

export interface TableStatRow {
  schema: string
  table: string
  totalBytes: number
  tableBytes: number
  indexBytes: number
  estimatedRows: number
  deadTuples?: number
  lastVacuum?: string | null
  lastAutovacuum?: string | null
}

export async function getTableStats(connectionId: number): Promise<TableStatRow[]> {
  const conn = await getConnWithSsh(connectionId)
  switch (conn.dbType) {
    case 'postgresql': {
      let client: InstanceType<typeof PgClient> | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        const res = await client.query(`
          SELECT
            n.nspname AS schema,
            c.relname AS table,
            pg_total_relation_size(c.oid) AS total_bytes,
            pg_relation_size(c.oid) AS table_bytes,
            pg_indexes_size(c.oid) AS index_bytes,
            c.reltuples::bigint AS estimated_rows,
            s.n_dead_tup AS dead_tuples,
            s.last_vacuum,
            s.last_autovacuum
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY total_bytes DESC
        `)
        return res.rows.map((r) => ({
          schema: r.schema,
          table: r.table,
          totalBytes: Number(r.total_bytes),
          tableBytes: Number(r.table_bytes),
          indexBytes: Number(r.index_bytes),
          estimatedRows: Number(r.estimated_rows),
          deadTuples: r.dead_tuples != null ? Number(r.dead_tuples) : undefined,
          lastVacuum: r.last_vacuum ? String(r.last_vacuum) : null,
          lastAutovacuum: r.last_autovacuum ? String(r.last_autovacuum) : null,
        }))
      } finally {
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        const [rows] = await connection.query(`
          SELECT
            TABLE_SCHEMA AS \`schema\`,
            TABLE_NAME AS \`table\`,
            (DATA_LENGTH + INDEX_LENGTH) AS total_bytes,
            DATA_LENGTH AS table_bytes,
            INDEX_LENGTH AS index_bytes,
            TABLE_ROWS AS estimated_rows
          FROM information_schema.TABLES
          WHERE TABLE_TYPE = 'BASE TABLE'
            AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
          ORDER BY total_bytes DESC
        `)
        return (rows as Record<string, unknown>[]).map((r) => ({
          schema: String(r['schema'] ?? ''),
          table: String(r['table'] ?? ''),
          totalBytes: Number(r['total_bytes'] ?? 0),
          tableBytes: Number(r['table_bytes'] ?? 0),
          indexBytes: Number(r['index_bytes'] ?? 0),
          estimatedRows: Number(r['estimated_rows'] ?? 0),
        }))
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    default:
      return []
  }
}
