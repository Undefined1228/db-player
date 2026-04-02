import { Client as PgClient } from 'pg'
import mysql from 'mysql2/promise'
import Database from 'better-sqlite3'
import { getConnectionWithPassword, type ConnectionWithPassword } from './connection-repository'
import { buildPostgresDDL, buildAlterTableDDL, type CreateTableParams, type AlterTableParams, type CreateTableColumnDef, type CreateTableFKDef } from './ddl-builder'
import { openSshTunnel, type SshConfig } from './ssh-tunnel'

async function getConnWithSsh(connectionId: number): Promise<ConnectionWithPassword> {
  const conn = getConnectionWithPassword(connectionId)
  if (!conn) throw new Error('연결 정보를 찾을 수 없습니다.')
  if (!conn.sshEnabled || !conn.sshHost || !conn.sshUsername) {
    return conn
  }
  const remoteHost = conn.host ?? '127.0.0.1'
  const remotePort = conn.port ?? (['mysql', 'mariadb'].includes(conn.dbType) ? 3306 : 5432)
  const sshConfig: SshConfig = {
    host: conn.sshHost,
    port: conn.sshPort ?? 22,
    username: conn.sshUsername,
    authMethod: conn.sshAuthMethod,
    password: conn.sshPassword || undefined,
    privateKey: conn.sshPrivateKey || undefined,
    passphrase: conn.sshPassphrase || undefined,
  }
  const { localPort } = await openSshTunnel(conn.id, sshConfig, remoteHost, remotePort)
  return { ...conn, host: '127.0.0.1', port: localPort }
}

function buildPgConfig(conn: {
  host: string | null
  port: number | null
  databaseName: string | null
  username: string | null
  password: string
  url: string | null
  inputMode: string
}) {
  if (conn.inputMode === 'url' && conn.url) {
    const urlObj = new URL(conn.url.replace(/^jdbc:/i, ''))
    return {
      host: urlObj.hostname,
      port: Number(urlObj.port) || 5432,
      database: urlObj.pathname.slice(1) || undefined,
      user: conn.username ?? undefined,
      password: conn.password || undefined,
      connectionTimeoutMillis: 5000
    }
  }
  return {
    host: conn.host ?? undefined,
    port: conn.port ?? undefined,
    database: conn.databaseName ?? undefined,
    user: conn.username ?? undefined,
    password: conn.password || undefined,
    connectionTimeoutMillis: 5000
  }
}

function buildMysqlConfig(conn: {
  host: string | null
  port: number | null
  databaseName: string | null
  username: string | null
  password: string
  url: string | null
  inputMode: string
}): mysql.ConnectionOptions {
  if (conn.inputMode === 'url' && conn.url) {
    const u = new URL(conn.url.replace(/^jdbc:/i, ''))
    return { host: u.hostname, port: Number(u.port) || 3306, database: u.pathname.slice(1) || undefined, user: conn.username ?? undefined, password: conn.password || undefined }
  }
  return { host: conn.host ?? undefined, port: conn.port ?? undefined, database: conn.databaseName ?? undefined, user: conn.username ?? undefined, password: conn.password || undefined }
}

const runningQueryMap = new Map<number, { dbType: string; pgPid?: number; mysqlConnId?: number }>()

export interface SchemaInfo {
  name: string
  owned: boolean
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  isPrimaryKey: boolean
  defaultValue: string | null
}

export interface FKInfo {
  constraintName: string
  localColumns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
  onDelete: string
  onUpdate: string
}

export interface IndexInfo {
  name: string
  unique: boolean
  columns: string[]
}

export interface TableInfo {
  name: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  sequences: string[]
  foreignKeys: FKInfo[]
}

export interface ViewInfo {
  name: string
  columns: ColumnInfo[]
}

export interface MatViewInfo {
  name: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
}

export interface SchemaObjects {
  tables: TableInfo[]
  views: ViewInfo[]
  materialized_views: MatViewInfo[]
  functions: string[]
}

export async function getRoles(connectionId: number): Promise<string[]> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    const result = await client.query(
      `SELECT rolname FROM pg_roles ORDER BY rolname`
    )
    return result.rows.map((r) => r.rolname as string)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function createSchema(
  connectionId: number,
  schemaName: string,
  owner?: string
): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  let sql = `CREATE SCHEMA ${quoteIdent(schemaName)}`
  if (owner) sql += ` AUTHORIZATION ${quoteIdent(owner)}`

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function getSchemaOwner(connectionId: number, schemaName: string): Promise<string> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    const result = await client.query(
      `SELECT r.rolname AS owner
       FROM pg_namespace n
       JOIN pg_roles r ON r.oid = n.nspowner
       WHERE n.nspname = $1`,
      [schemaName]
    )
    if (!result.rows.length) throw new Error(`스키마 '${schemaName}'을 찾을 수 없습니다.`)
    return result.rows[0].owner as string
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function alterSchema(
  connectionId: number,
  schemaName: string,
  newName?: string,
  newOwner?: string
): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()

    let currentName = schemaName
    if (newName && newName !== schemaName) {
      await client.query(`ALTER SCHEMA ${quoteIdent(currentName)} RENAME TO ${quoteIdent(newName)}`)
      currentName = newName
    }
    if (newOwner) {
      await client.query(`ALTER SCHEMA ${quoteIdent(currentName)} OWNER TO ${quoteIdent(newOwner)}`)
    }
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function dropSchema(
  connectionId: number,
  schemaName: string,
  cascade: boolean
): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const sql = `DROP SCHEMA ${quoteIdent(schemaName)} ${cascade ? 'CASCADE' : 'RESTRICT'}`

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function getTableNames(connectionId: number, schemaName: string): Promise<string[]> {
  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = ? AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        [schemaName]
      )
      return rows.map((r) => r.name as string)
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') throw new Error('지원하지 않는 DB 유형입니다.')

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    const result = await client.query(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
      [schemaName]
    )
    return result.rows.map((r) => r.name as string)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function getColumnNames(connectionId: number, schemaName: string, tableName: string): Promise<string[]> {
  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position`,
        [schemaName, tableName]
      )
      return rows.map((r) => r.column_name as string)
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') throw new Error('지원하지 않는 DB 유형입니다.')

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schemaName, tableName]
    )
    return result.rows.map((r) => r.column_name as string)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function createTable(connectionId: number, params: CreateTableParams): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error(`${conn.dbType} 테이블 생성은 아직 지원되지 않습니다.`)

  const ddl = buildPostgresDDL(params)

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(ddl)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function alterTable(connectionId: number, params: AlterTableParams): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error(`${conn.dbType} 테이블 수정은 아직 지원되지 않습니다.`)

  const statements = buildAlterTableDDL(params)
  if (statements.length === 0) return

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query('BEGIN')
    for (const sql of statements) {
      await client.query(sql)
    }
    await client.query('COMMIT')
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function getSchemas(connectionId: number): Promise<SchemaInfo[]> {
  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT schema_name AS name
         FROM information_schema.schemata
         WHERE schema_name NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
         ORDER BY schema_name`
      )
      return rows.map((r) => ({ name: r.name as string, owned: false }))
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') {
    throw new Error(`${conn.dbType}는 아직 스키마 조회를 지원하지 않습니다.`)
  }

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    const result = await client.query(`
      SELECT n.nspname AS name,
             (n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS owned
      FROM pg_namespace n
      WHERE n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp%'
      ORDER BY
        owned DESC,
        CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END,
        n.nspname
    `)
    return result.rows.map((r) => ({ name: r.name as string, owned: r.owned as boolean }))
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function getSchemaObjects(connectionId: number, schemaName: string): Promise<SchemaObjects> {
  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      const db = schemaName

      const [[tableRows], [viewRows]] = await Promise.all([
        connection.query<mysql.RowDataPacket[]>(
          `SELECT table_name AS name FROM information_schema.tables
           WHERE table_schema = ? AND table_type = 'BASE TABLE'
           ORDER BY table_name`,
          [db]
        ),
        connection.query<mysql.RowDataPacket[]>(
          `SELECT table_name AS name FROM information_schema.tables
           WHERE table_schema = ? AND table_type = 'VIEW'
           ORDER BY table_name`,
          [db]
        )
      ])

      const tableNames = tableRows.map((r) => r.name as string)
      const viewNames = viewRows.map((r) => r.name as string)
      const allNames = [...tableNames, ...viewNames]

      if (allNames.length === 0) {
        return { tables: [], views: [], materialized_views: [], functions: [] }
      }

      const inPlaceholders = (arr: string[]): string => arr.map(() => '?').join(',')

      const [[columnsRows], [pkRows], [fkRows], [indexRows]] = await Promise.all([
        connection.query<mysql.RowDataPacket[]>(
          `SELECT table_name, column_name, column_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = ? AND table_name IN (${inPlaceholders(allNames)})
           ORDER BY table_name, ordinal_position`,
          [db, ...allNames]
        ),
        connection.query<mysql.RowDataPacket[]>(
          `SELECT table_name, column_name
           FROM information_schema.key_column_usage
           WHERE table_schema = ? AND constraint_name = 'PRIMARY'
             AND table_name IN (${inPlaceholders(allNames)})`,
          [db, ...allNames]
        ),
        tableNames.length > 0
          ? connection.query<mysql.RowDataPacket[]>(
              `SELECT kcu.table_name, kcu.constraint_name,
                      kcu.column_name AS local_column,
                      kcu.referenced_table_schema AS ref_schema,
                      kcu.referenced_table_name AS ref_table,
                      kcu.referenced_column_name AS ref_column,
                      rc.delete_rule, rc.update_rule
               FROM information_schema.key_column_usage kcu
               JOIN information_schema.referential_constraints rc
                 ON kcu.constraint_name = rc.constraint_name
                 AND kcu.constraint_schema = rc.constraint_schema
               WHERE kcu.table_schema = ?
                 AND kcu.referenced_table_name IS NOT NULL
                 AND kcu.table_name IN (${inPlaceholders(tableNames)})
               ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position`,
              [db, ...tableNames]
            )
          : Promise.resolve([[] as mysql.RowDataPacket[]]),
        tableNames.length > 0
          ? connection.query<mysql.RowDataPacket[]>(
              `SELECT table_name, index_name, non_unique, column_name
               FROM information_schema.statistics
               WHERE table_schema = ? AND index_name != 'PRIMARY'
                 AND table_name IN (${inPlaceholders(tableNames)})
               ORDER BY table_name, index_name, seq_in_index`,
              [db, ...tableNames]
            )
          : Promise.resolve([[] as mysql.RowDataPacket[]])
      ])

      const pkSet = new Set(pkRows.map((r) => `${r.table_name}.${r.column_name}`))

      const columnsByTable = new Map<string, ColumnInfo[]>()
      for (const r of columnsRows) {
        const tbl = r.table_name as string
        if (!columnsByTable.has(tbl)) columnsByTable.set(tbl, [])
        columnsByTable.get(tbl)!.push({
          name: r.column_name as string,
          dataType: r.column_type as string,
          nullable: r.is_nullable === 'YES',
          isPrimaryKey: pkSet.has(`${tbl}.${r.column_name}`),
          defaultValue: r.column_default as string | null
        })
      }

      const fksByTable = new Map<string, FKInfo[]>()
      const fkMap = new Map<string, FKInfo>()
      for (const r of fkRows) {
        const tbl = r.table_name as string
        const key = `${tbl}.${r.constraint_name as string}`
        if (!fkMap.has(key)) {
          const fk: FKInfo = {
            constraintName: r.constraint_name as string,
            localColumns: [],
            refSchema: r.ref_schema as string,
            refTable: r.ref_table as string,
            refColumns: [],
            onDelete: r.delete_rule as string,
            onUpdate: r.update_rule as string
          }
          fkMap.set(key, fk)
          if (!fksByTable.has(tbl)) fksByTable.set(tbl, [])
          fksByTable.get(tbl)!.push(fk)
        }
        fkMap.get(key)!.localColumns.push(r.local_column as string)
        fkMap.get(key)!.refColumns.push(r.ref_column as string)
      }

      const indexesByTable = new Map<string, IndexInfo[]>()
      const indexMap = new Map<string, IndexInfo>()
      for (const r of indexRows) {
        const tbl = r.table_name as string
        const key = `${tbl}.${r.index_name as string}`
        if (!indexMap.has(key)) {
          const idx: IndexInfo = {
            name: r.index_name as string,
            unique: (r.non_unique as number) === 0,
            columns: []
          }
          indexMap.set(key, idx)
          if (!indexesByTable.has(tbl)) indexesByTable.set(tbl, [])
          indexesByTable.get(tbl)!.push(idx)
        }
        indexMap.get(key)!.columns.push(r.column_name as string)
      }

      return {
        tables: tableNames.map((name) => ({
          name,
          columns: columnsByTable.get(name) ?? [],
          indexes: indexesByTable.get(name) ?? [],
          sequences: [],
          foreignKeys: fksByTable.get(name) ?? []
        })),
        views: viewNames.map((name) => ({
          name,
          columns: columnsByTable.get(name) ?? []
        })),
        materialized_views: [],
        functions: []
      }
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') {
    throw new Error(`${conn.dbType}는 아직 스키마 오브젝트 조회를 지원하지 않습니다.`)
  }

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()

    const [tableNames, viewNames, matViewNames, functions] = await Promise.all([
      client.query(
        `SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
        [schemaName]
      ),
      client.query(
        `SELECT viewname AS name FROM pg_views WHERE schemaname = $1 ORDER BY viewname`,
        [schemaName]
      ),
      client.query(
        `SELECT matviewname AS name FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname`,
        [schemaName]
      ),
      client.query(
        `SELECT p.proname AS name
         FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
         ORDER BY p.proname`,
        [schemaName]
      )
    ])

    const allRelNames = [
      ...tableNames.rows.map((r) => r.name as string),
      ...viewNames.rows.map((r) => r.name as string),
      ...matViewNames.rows.map((r) => r.name as string)
    ]

    const tableRelNames = tableNames.rows.map((r) => r.name as string)

    const [columnsResult, pkResult, indexesResult, sequencesResult, fkResult] = await Promise.all([
      allRelNames.length > 0
        ? client.query(
            `SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
                    c.character_maximum_length, c.numeric_precision, c.numeric_scale,
                    c.is_nullable, c.column_default
             FROM information_schema.columns c
             WHERE c.table_schema = $1 AND c.table_name = ANY($2)
             ORDER BY c.table_name, c.ordinal_position`,
            [schemaName, allRelNames]
          )
        : { rows: [] },
      allRelNames.length > 0
        ? client.query(
            `SELECT kcu.table_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema = $1
               AND tc.table_name = ANY($2)`,
            [schemaName, allRelNames]
          )
        : { rows: [] },
      client.query(
        `SELECT
           i.tablename,
           i.indexname,
           ix.indisunique AS is_unique,
           (
             SELECT array_agg(
               CASE WHEN k.attnum > 0 THEN a.attname ELSE '<expr>' END
               ORDER BY k.ord
             )
             FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
             LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
           ) AS columns
         FROM pg_indexes i
         JOIN pg_class c ON c.relname = i.indexname AND c.relkind = 'i'
         JOIN pg_namespace ns ON ns.nspname = i.schemaname AND ns.oid = c.relnamespace
         JOIN pg_index ix ON ix.indexrelid = c.oid
         WHERE i.schemaname = $1
         ORDER BY i.tablename, i.indexname`,
        [schemaName]
      ),
      client.query(
        `SELECT s.sequencename,
                d.refobjsubid,
                c.relname AS table_name
         FROM pg_sequences s
         JOIN pg_class seq_class ON seq_class.relname = s.sequencename
           AND seq_class.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
         LEFT JOIN pg_depend d ON d.objid = seq_class.oid AND d.deptype = 'a'
         LEFT JOIN pg_class c ON c.oid = d.refobjid
         WHERE s.schemaname = $1
         ORDER BY s.sequencename`,
        [schemaName]
      ),
      tableRelNames.length > 0
        ? client.query(
            `SELECT tc.table_name, tc.constraint_name,
                    rc.delete_rule, rc.update_rule,
                    kcu.column_name AS local_column,
                    ccu.table_schema AS ref_schema,
                    ccu.table_name AS ref_table,
                    ccu.column_name AS ref_column
             FROM information_schema.table_constraints tc
             JOIN information_schema.referential_constraints rc
               ON tc.constraint_name = rc.constraint_name
               AND tc.constraint_schema = rc.constraint_schema
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.constraint_schema = kcu.constraint_schema
             JOIN information_schema.constraint_column_usage ccu
               ON rc.unique_constraint_name = ccu.constraint_name
               AND rc.unique_constraint_schema = ccu.constraint_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_schema = $1
               AND tc.table_name = ANY($2)
             ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
            [schemaName, tableRelNames]
          )
        : { rows: [] }
    ])

    const pkSet = new Set(pkResult.rows.map((r) => `${r.table_name}.${r.column_name}`))

    const fksByTable = new Map<string, FKInfo[]>()
    const fkMap = new Map<string, FKInfo>()
    for (const r of fkResult.rows) {
      const tbl = r.table_name as string
      const key = `${tbl}.${r.constraint_name as string}`
      if (!fkMap.has(key)) {
        const fk: FKInfo = {
          constraintName: r.constraint_name as string,
          localColumns: [],
          refSchema: r.ref_schema as string,
          refTable: r.ref_table as string,
          refColumns: [],
          onDelete: r.delete_rule as string,
          onUpdate: r.update_rule as string
        }
        fkMap.set(key, fk)
        if (!fksByTable.has(tbl)) fksByTable.set(tbl, [])
        fksByTable.get(tbl)!.push(fk)
      }
      fkMap.get(key)!.localColumns.push(r.local_column as string)
      fkMap.get(key)!.refColumns.push(r.ref_column as string)
    }

    const columnsByTable = new Map<string, ColumnInfo[]>()
    for (const r of columnsResult.rows) {
      const tableName = r.table_name as string
      if (!columnsByTable.has(tableName)) columnsByTable.set(tableName, [])
      columnsByTable.get(tableName)!.push({
        name: r.column_name as string,
        dataType: formatDataType(r),
        nullable: r.is_nullable === 'YES',
        isPrimaryKey: pkSet.has(`${tableName}.${r.column_name}`),
        defaultValue: r.column_default as string | null
      })
    }

    const indexesByTable = new Map<string, IndexInfo[]>()
    for (const r of indexesResult.rows) {
      const t = r.tablename as string
      if (!indexesByTable.has(t)) indexesByTable.set(t, [])
      indexesByTable.get(t)!.push({
        name: r.indexname as string,
        unique: r.is_unique as boolean,
        columns: (r.columns as string[]) ?? []
      })
    }

    const seqByTable = new Map<string, string[]>()
    for (const r of sequencesResult.rows) {
      const t = (r.table_name as string) || '__unlinked__'
      if (!seqByTable.has(t)) seqByTable.set(t, [])
      seqByTable.get(t)!.push(r.sequencename as string)
    }

    const tables: TableInfo[] = tableNames.rows.map((r) => {
      const name = r.name as string
      return {
        name,
        columns: columnsByTable.get(name) ?? [],
        indexes: indexesByTable.get(name) ?? [],
        sequences: seqByTable.get(name) ?? [],
        foreignKeys: fksByTable.get(name) ?? []
      }
    })

    const views: ViewInfo[] = viewNames.rows.map((r) => {
      const name = r.name as string
      return { name, columns: columnsByTable.get(name) ?? [] }
    })

    const materialized_views: MatViewInfo[] = matViewNames.rows.map((r) => {
      const name = r.name as string
      return {
        name,
        columns: columnsByTable.get(name) ?? [],
        indexes: indexesByTable.get(name) ?? []
      }
    })

    return {
      tables,
      views,
      materialized_views,
      functions: functions.rows.map((r) => r.name as string)
    }
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function createView(
  connectionId: number,
  schemaName: string,
  viewName: string,
  selectQuery: string
): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const sql = `CREATE OR REPLACE VIEW ${quoteIdent(schemaName)}.${quoteIdent(viewName)} AS\n${selectQuery}`

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function alterView(
  connectionId: number,
  schemaName: string,
  viewName: string,
  newViewName: string | undefined,
  newSelectQuery: string | undefined
): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query('BEGIN')

    if (newSelectQuery !== undefined) {
      const currentName = viewName
      const sql = `CREATE OR REPLACE VIEW ${quoteIdent(schemaName)}.${quoteIdent(currentName)} AS\n${newSelectQuery}`
      await client.query(sql)
    }

    if (newViewName && newViewName !== viewName) {
      await client.query(
        `ALTER VIEW ${quoteIdent(schemaName)}.${quoteIdent(viewName)} RENAME TO ${quoteIdent(newViewName)}`
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function dropView(
  connectionId: number,
  schemaName: string,
  viewName: string,
  cascade: boolean
): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const sql = `DROP VIEW ${quoteIdent(schemaName)}.${quoteIdent(viewName)}${cascade ? ' CASCADE' : ''}`

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export interface CreateIndexParams {
  schemaName: string
  tableName: string
  indexName: string
  columns: { name: string; order: 'ASC' | 'DESC' }[]
  unique: boolean
  method: string
}

export async function createIndex(connectionId: number, params: CreateIndexParams): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const colList = params.columns.map((c) => `${quoteIdent(c.name)} ${c.order}`).join(', ')
  const sql =
    `CREATE ${params.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(params.indexName)}` +
    ` ON ${quoteIdent(params.schemaName)}.${quoteIdent(params.tableName)}` +
    ` USING ${params.method} (${colList})`

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function dropIndex(
  connectionId: number,
  schemaName: string,
  indexName: string
): Promise<void> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const sql = `DROP INDEX ${quoteIdent(schemaName)}.${quoteIdent(indexName)}`

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export async function getObjectDDL(
  connectionId: number,
  schemaName: string,
  objectName: string,
  objectType: 'table' | 'view' | 'matview' | 'function'
): Promise<string> {
  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      const db = schemaName
      const quotedRef = `\`${db}\`.\`${objectName}\``

      if (objectType === 'view') {
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SHOW CREATE VIEW ${quotedRef}`
        )
        return (rows[0]?.['Create View'] as string) ?? ''
      }

      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SHOW CREATE TABLE ${quotedRef}`
      )
      return (rows[0]?.['Create Table'] as string) ?? ''
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') throw new Error('지원하지 않는 DB 유형입니다.')

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()

    if (objectType === 'view') {
      const result = await client.query(
        `SELECT pg_get_viewdef(c.oid, true) AS def
         FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schemaName, objectName]
      )
      const def = (result.rows[0]?.def as string ?? '').trim()
      return `CREATE OR REPLACE VIEW "${schemaName}"."${objectName}" AS\n${def}`
    }

    if (objectType === 'matview') {
      const result = await client.query(
        `SELECT definition FROM pg_matviews WHERE schemaname = $1 AND matviewname = $2`,
        [schemaName, objectName]
      )
      const def = (result.rows[0]?.definition as string ?? '').trim()
      return `CREATE MATERIALIZED VIEW "${schemaName}"."${objectName}" AS\n${def}`
    }

    if (objectType === 'function') {
      const result = await client.query(
        `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = $1 AND p.proname = $2
         LIMIT 1`,
        [schemaName, objectName]
      )
      return (result.rows[0]?.def as string ?? '').trim()
    }

    const [colResult, pkResult, fkResult] = await Promise.all([
      client.query(
        `SELECT column_name, udt_name, character_maximum_length,
                numeric_precision, numeric_scale, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schemaName, objectName]
      ),
      client.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schemaName, objectName]
      ),
      client.query(
        `SELECT tc.constraint_name, rc.delete_rule, rc.update_rule,
                kcu.column_name AS local_column,
                ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc
           ON tc.constraint_name = rc.constraint_name AND tc.constraint_schema = rc.constraint_schema
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2
         ORDER BY tc.constraint_name, kcu.ordinal_position`,
        [schemaName, objectName]
      )
    ])

    const UDT_MAP: Record<string, string> = {
      int2: 'smallint', int4: 'integer', int8: 'bigint',
      float4: 'real', float8: 'double precision', bool: 'boolean', bpchar: 'char',
    }

    const pkCols = new Set(pkResult.rows.map((r) => r.column_name as string))

    const columns: CreateTableColumnDef[] = colResult.rows.map((r) => {
      const udt = r.udt_name as string
      const charLen = r.character_maximum_length as number | null
      const numPrec = r.numeric_precision as number | null
      const numScale = r.numeric_scale as number | null
      const type = UDT_MAP[udt] ?? udt
      const size = charLen
        ? String(charLen)
        : numPrec && numScale && numScale > 0
          ? `${numPrec},${numScale}`
          : ''
      return {
        name: r.column_name as string,
        type,
        size,
        nullable: r.is_nullable === 'YES',
        primaryKey: pkCols.has(r.column_name as string),
        defaultValue: (r.column_default as string | null) ?? '',
      }
    })

    const fkMap = new Map<string, CreateTableFKDef>()
    for (const r of fkResult.rows) {
      const name = r.constraint_name as string
      if (!fkMap.has(name)) {
        fkMap.set(name, {
          constraintName: name,
          localColumns: [],
          refSchema: r.ref_schema as string,
          refTable: r.ref_table as string,
          refColumns: [],
          onDelete: r.delete_rule as string,
          onUpdate: r.update_rule as string,
        })
      }
      fkMap.get(name)!.localColumns.push(r.local_column as string)
      fkMap.get(name)!.refColumns.push(r.ref_column as string)
    }

    return buildPostgresDDL({ schemaName, tableName: objectName, columns, foreignKeys: [...fkMap.values()] })
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export interface SelectAllParams {
  limit: number
  offset: number
  orderBy: { col: string; dir: 'asc' | 'desc' }[]
  search: string
}

export async function selectAll(
  connectionId: number,
  schemaName: string,
  tableName: string,
  params: SelectAllParams
): Promise<{ columns: string[]; primaryKeys: string[]; rows: Record<string, unknown>[]; totalCount: number; columnDefaults: Record<string, string | null>; columnTypes: Record<string, string> }> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const tableRef = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()

    const [colResult, pkResult] = await Promise.all([
      client.query(
        `SELECT column_name, column_default, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schemaName, tableName]
      ),
      client.query(
        `SELECT a.attname
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         WHERE c.contype = 'p'
           AND c.conrelid = (
             SELECT c.oid FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = $1 AND n.nspname = $2
           )
         ORDER BY a.attnum`,
        [tableName, schemaName]
      )
    ])

    const columnNames = colResult.rows.map((r) => r.column_name as string)
    const columnDefaults: Record<string, string | null> = {}
    const columnTypes: Record<string, string> = {}
    for (const r of colResult.rows) {
      columnDefaults[r.column_name as string] = r.column_default as string | null
      columnTypes[r.column_name as string] = r.udt_name as string
    }
    const primaryKeys = pkResult.rows.map((r) => r.attname as string)

    const searchPattern = params.search ? `%${params.search}%` : null
    const whereClause =
      searchPattern && columnNames.length > 0
        ? `WHERE (${columnNames.map((col) => `CAST(${quoteIdent(col)} AS TEXT) ILIKE $1`).join(' OR ')})`
        : ''
    const baseParams: unknown[] = searchPattern ? [searchPattern] : []

    const countResult = await client.query(
      `SELECT COUNT(*) AS count FROM ${tableRef} ${whereClause}`,
      baseParams
    )
    const totalCount = Number(countResult.rows[0].count)

    const orderClause =
      params.orderBy.length > 0
        ? `ORDER BY ${params.orderBy.map(({ col, dir }) => `${quoteIdent(col)} ${dir === 'desc' ? 'DESC' : 'ASC'}`).join(', ')}`
        : ''

    const dataParams = [...baseParams]
    let limitClause = ''
    if (params.limit > 0) {
      limitClause = `LIMIT $${dataParams.length + 1} OFFSET $${dataParams.length + 2}`
      dataParams.push(params.limit, params.offset)
    }

    const sql = [
      `SELECT * FROM ${tableRef}`,
      whereClause,
      orderClause,
      limitClause,
    ]
      .filter(Boolean)
      .join(' ')

    const dataResult = await client.query(sql, dataParams)

    return {
      columns: columnNames,
      primaryKeys,
      rows: dataResult.rows,
      totalCount,
      columnDefaults,
      columnTypes,
    }
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export interface DataChangeRow {
  original: Record<string, unknown>
  changes: Record<string, unknown>
}

export interface DataChangesParams {
  schemaName: string
  tableName: string
  primaryKeys: string[]
  inserts: Record<string, unknown>[]
  updates: DataChangeRow[]
  deletes: Record<string, unknown>[]
}

/**
 * INSERT/UPDATE/DELETE 변경사항을 트랜잭션 안에서 순서대로 실행한다.
 * DELETE → UPDATE → INSERT 순. PostgreSQL 전용.
 */
export async function executeDataChanges(
  connectionId: number,
  params: DataChangesParams
): Promise<{ success: true }> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const isMetaKey = (k: string): boolean => k.startsWith('__')

  const { schemaName, tableName, primaryKeys, inserts, updates, deletes } = params
  const tableRef = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`

  const buildWhere = (row: Record<string, unknown>, offset: number): { clause: string; values: unknown[] } => {
    const whereCols = primaryKeys.length > 0
      ? primaryKeys
      : Object.keys(row).filter((k) => !isMetaKey(k))
    const values = whereCols.map((k) => row[k])
    const clause = whereCols.map((k, i) => `${quoteIdent(k)} = $${offset + i + 1}`).join(' AND ')
    return { clause, values }
  }

  let client: PgClient | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query('BEGIN')

    for (const row of deletes) {
      const { clause, values } = buildWhere(row, 0)
      await client.query(`DELETE FROM ${tableRef} WHERE ${clause}`, values)
    }

    for (const { original, changes } of updates) {
      const setCols = Object.keys(changes).filter((k) => !isMetaKey(k))
      if (setCols.length === 0) continue
      const setClause = setCols.map((col, i) => `${quoteIdent(col)} = $${i + 1}`).join(', ')
      const { clause: whereClause, values: whereValues } = buildWhere(original, setCols.length)
      const values = [...setCols.map((col) => changes[col]), ...whereValues]
      await client.query(`UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`, values)
    }

    for (const row of inserts) {
      const cols = Object.keys(row).filter((k) => !isMetaKey(k))
      if (cols.length === 0) continue
      const colClause = cols.map((c) => quoteIdent(c)).join(', ')
      const valClause = cols.map((_, i) => `$${i + 1}`).join(', ')
      const values = cols.map((c) => row[c])
      await client.query(`INSERT INTO ${tableRef} (${colClause}) VALUES (${valClause})`, values)
    }

    await client.query('COMMIT')
    return { success: true }
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

function formatDataType(row: Record<string, unknown>): string {
  const udt = row.udt_name as string
  const charLen = row.character_maximum_length as number | null
  const numPrec = row.numeric_precision as number | null
  const numScale = row.numeric_scale as number | null

  if (charLen) return `${udt}(${charLen})`
  if (numPrec && numScale && numScale > 0) return `numeric(${numPrec},${numScale})`
  return udt
}

export type QueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; affectedRows: number | null; columnTypes: Record<string, string> }
  | { ok: false; message: string; position?: number }

export async function executeQuery(connectionId: number, sql: string): Promise<QueryResult> {
  const conn = getConnectionWithPassword(connectionId)
  if (!conn) return { ok: false, message: '연결 정보를 찾을 수 없습니다.' }

  switch (conn.dbType) {
    case 'postgresql': {
      let client: PgClient | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        runningQueryMap.set(connectionId, { dbType: 'postgresql', pgPid: (client as unknown as { processID?: number }).processID ?? undefined })
        const result = await client.query(sql)
        const columns = result.fields ? result.fields.map((f) => f.name) : []
        const columnTypes: Record<string, string> = {}
        if (result.fields) {
          for (const f of result.fields) columnTypes[f.name] = pgOidToCategory(f.dataTypeID)
        }
        return { ok: true, columns, rows: result.rows ?? [], affectedRows: result.rowCount ?? null, columnTypes }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const position = (err as { position?: string }).position ? Number((err as { position?: string }).position) : undefined
        return { ok: false, message, position }
      } finally {
        runningQueryMap.delete(connectionId)
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      let connection: mysql.Connection | undefined
      try {
        connection = await mysql.createConnection(buildMysqlConfig(conn))
        runningQueryMap.set(connectionId, { dbType: conn.dbType, mysqlConnId: connection.threadId ?? undefined })
        const [rowsOrOk, fields] = await connection.query(sql)
        if (Array.isArray(rowsOrOk) && fields) {
          const columns = (fields as mysql.FieldPacket[]).map((f) => f.name)
          const columnTypes: Record<string, string> = {}
          for (const f of fields as mysql.FieldPacket[]) columnTypes[f.name] = mysqlTypeToCategory((f as unknown as { type: number }).type ?? 0)
          return { ok: true, columns, rows: rowsOrOk as Record<string, unknown>[], affectedRows: null, columnTypes }
        }
        const ok = rowsOrOk as mysql.ResultSetHeader
        return { ok: true, columns: [], rows: [], affectedRows: ok.affectedRows ?? null, columnTypes: {} }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      } finally {
        runningQueryMap.delete(connectionId)
        if (connection) await connection.end().catch(() => {})
      }
    }
    case 'sqlite': {
      const filePath = conn.filePath
      if (!filePath) return { ok: false, message: 'SQLite 파일 경로가 없습니다.' }
      const db = new Database(filePath)
      try {
        const stmt = db.prepare(sql)
        if (stmt.reader) {
          const columnInfos = stmt.columns()
          const rows = stmt.all() as Record<string, unknown>[]
          const columns = columnInfos.map((c) => c.name)
          const columnTypes: Record<string, string> = {}
          for (const c of columnInfos) columnTypes[c.name] = sqliteTypeToCategory(c.type)
          return { ok: true, columns, rows, affectedRows: null, columnTypes }
        } else {
          const info = stmt.run()
          return { ok: true, columns: [], rows: [], affectedRows: info.changes, columnTypes: {} }
        }
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

export type BatchQueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; affectedRows: number | null; executionTime: number; columnTypes: Record<string, string> }
  | { ok: false; message: string; position?: number; executionTime: number; skipped?: true }

export type BatchQueryResponse = {
  results: BatchQueryResult[]
  transactionResult?: 'committed' | 'rolledback'
}

export async function executeQueryBatch(
  connectionId: number,
  sqls: string[],
  stopOnError: boolean,
  useTransaction: boolean = false
): Promise<BatchQueryResponse> {
  const conn = getConnectionWithPassword(connectionId)
  if (!conn) {
    return { results: sqls.map(() => ({ ok: false as const, message: '연결 정보를 찾을 수 없습니다.', executionTime: 0 })) }
  }

  const results: BatchQueryResult[] = []
  let transactionResult: 'committed' | 'rolledback' | undefined

  switch (conn.dbType) {
    case 'postgresql': {
      const client = new PgClient(buildPgConfig(conn))
      let errorOccurred = false
      try {
        await client.connect()
        runningQueryMap.set(connectionId, { dbType: 'postgresql', pgPid: (client as unknown as { processID?: number }).processID ?? undefined })
        if (useTransaction) await client.query('BEGIN')
        for (let i = 0; i < sqls.length; i++) {
          const sql = sqls[i]
          const start = Date.now()
          try {
            const result = await client.query(sql)
            const executionTime = Date.now() - start
            const columns = result.fields ? result.fields.map((f) => f.name) : []
            const columnTypes: Record<string, string> = {}
            if (result.fields) {
              for (const f of result.fields) columnTypes[f.name] = pgOidToCategory(f.dataTypeID)
            }
            results.push({ ok: true, columns, rows: result.rows ?? [], affectedRows: result.rowCount ?? null, executionTime, columnTypes })
          } catch (err) {
            const executionTime = Date.now() - start
            const message = err instanceof Error ? err.message : String(err)
            const position = (err as { position?: string }).position ? Number((err as { position?: string }).position) : undefined
            results.push({ ok: false, message, position, executionTime })
            errorOccurred = true
            if (stopOnError) {
              for (let j = i + 1; j < sqls.length; j++) {
                results.push({ ok: false, message: '이전 쿼리 실패로 인해 실행되지 않았습니다.', executionTime: 0, skipped: true })
              }
              break
            }
          }
        }
        if (useTransaction) {
          if (errorOccurred) {
            await client.query('ROLLBACK').catch(() => {})
            transactionResult = 'rolledback'
          } else {
            await client.query('COMMIT')
            transactionResult = 'committed'
          }
        }
      } finally {
        runningQueryMap.delete(connectionId)
        await client.end().catch(() => {})
      }
      break
    }
    case 'mariadb':
    case 'mysql': {
      const connection = await mysql.createConnection(buildMysqlConfig(conn))
      let errorOccurred = false
      try {
        runningQueryMap.set(connectionId, { dbType: conn.dbType, mysqlConnId: connection.threadId ?? undefined })
        if (useTransaction) await connection.beginTransaction()
        for (let i = 0; i < sqls.length; i++) {
          const sql = sqls[i]
          const start = Date.now()
          try {
            const [rowsOrOk, fields] = await connection.query(sql)
            const executionTime = Date.now() - start
            if (Array.isArray(rowsOrOk) && fields) {
              const columns = (fields as mysql.FieldPacket[]).map((f) => f.name)
              const columnTypes: Record<string, string> = {}
              for (const f of fields as mysql.FieldPacket[]) columnTypes[f.name] = mysqlTypeToCategory((f as unknown as { type: number }).type ?? 0)
              results.push({ ok: true, columns, rows: rowsOrOk as Record<string, unknown>[], affectedRows: null, executionTime, columnTypes })
            } else {
              const ok = rowsOrOk as mysql.ResultSetHeader
              results.push({ ok: true, columns: [], rows: [], affectedRows: ok.affectedRows ?? null, executionTime, columnTypes: {} })
            }
          } catch (err) {
            const executionTime = Date.now() - start
            results.push({ ok: false, message: err instanceof Error ? err.message : String(err), executionTime })
            errorOccurred = true
            if (stopOnError) {
              for (let j = i + 1; j < sqls.length; j++) {
                results.push({ ok: false, message: '이전 쿼리 실패로 인해 실행되지 않았습니다.', executionTime: 0, skipped: true })
              }
              break
            }
          }
        }
        if (useTransaction) {
          if (errorOccurred) {
            await connection.rollback()
            transactionResult = 'rolledback'
          } else {
            await connection.commit()
            transactionResult = 'committed'
          }
        }
      } finally {
        runningQueryMap.delete(connectionId)
        await connection.end().catch(() => {})
      }
      break
    }
    case 'sqlite': {
      const filePath = conn.filePath
      if (!filePath) {
        return { results: sqls.map(() => ({ ok: false as const, message: 'SQLite 파일 경로가 없습니다.', executionTime: 0 })) }
      }
      const db = new Database(filePath)
      let errorOccurred = false
      try {
        if (useTransaction) db.exec('BEGIN')
        for (let i = 0; i < sqls.length; i++) {
          const sql = sqls[i]
          const start = Date.now()
          try {
            const stmt = db.prepare(sql)
            const executionTime = Date.now() - start
            if (stmt.reader) {
              const columnInfos = stmt.columns()
              const rows = stmt.all() as Record<string, unknown>[]
              const columns = columnInfos.map((c) => c.name)
              const columnTypes: Record<string, string> = {}
              for (const c of columnInfos) columnTypes[c.name] = sqliteTypeToCategory(c.type)
              results.push({ ok: true, columns, rows, affectedRows: null, executionTime, columnTypes })
            } else {
              const info = stmt.run()
              results.push({ ok: true, columns: [], rows: [], affectedRows: info.changes, executionTime, columnTypes: {} })
            }
          } catch (err) {
            const executionTime = Date.now() - start
            results.push({ ok: false, message: err instanceof Error ? err.message : String(err), executionTime })
            errorOccurred = true
            if (stopOnError) {
              for (let j = i + 1; j < sqls.length; j++) {
                results.push({ ok: false, message: '이전 쿼리 실패로 인해 실행되지 않았습니다.', executionTime: 0, skipped: true })
              }
              break
            }
          }
        }
        if (useTransaction) {
          if (errorOccurred) {
            db.exec('ROLLBACK')
            transactionResult = 'rolledback'
          } else {
            db.exec('COMMIT')
            transactionResult = 'committed'
          }
        }
      } finally {
        db.close()
      }
      break
    }
    default:
      return { results: sqls.map(() => ({ ok: false as const, message: '지원하지 않는 DB 유형입니다.', executionTime: 0 })) }
  }

  return { results, transactionResult }
}

export async function cancelQuery(connectionId: number): Promise<{ ok: boolean }> {
  const info = runningQueryMap.get(connectionId)
  if (!info) return { ok: false }
  let conn
  try {
    conn = await getConnWithSsh(connectionId)
  } catch {
    return { ok: false }
  }

  if (info.dbType === 'postgresql' && info.pgPid !== undefined) {
    const cancelClient = new PgClient(buildPgConfig(conn))
    try {
      await cancelClient.connect()
      await cancelClient.query('SELECT pg_cancel_backend($1)', [info.pgPid])
    } finally {
      await cancelClient.end().catch(() => {})
    }
  } else if ((info.dbType === 'mysql' || info.dbType === 'mariadb') && info.mysqlConnId !== undefined) {
    const cancelConn = await mysql.createConnection(buildMysqlConfig(conn))
    try {
      await cancelConn.query('KILL QUERY ?', [info.mysqlConnId])
    } finally {
      await cancelConn.end().catch(() => {})
    }
  }
  return { ok: true }
}

export async function getCompletionSchema(
  connectionId: number,
  schemaName?: string
): Promise<Record<string, string[]>> {
  const conn = await getConnWithSsh(connectionId)

  switch (conn.dbType) {
    case 'postgresql': {
      let client: PgClient | undefined
      try {
        client = new PgClient(buildPgConfig(conn))
        await client.connect()
        const tablesResult = schemaName
          ? await client.query(
              `SELECT t.table_schema, t.table_name, c.column_name
               FROM information_schema.tables t
               JOIN information_schema.columns c
                 ON c.table_schema = t.table_schema AND c.table_name = t.table_name
               WHERE t.table_schema = $1 AND t.table_type IN ('BASE TABLE', 'VIEW')
               ORDER BY t.table_name, c.ordinal_position`,
              [schemaName]
            )
          : await client.query(
              `SELECT t.table_schema, t.table_name, c.column_name
               FROM information_schema.tables t
               JOIN information_schema.columns c
                 ON c.table_schema = t.table_schema AND c.table_name = t.table_name
               WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                 AND t.table_type IN ('BASE TABLE', 'VIEW')
               ORDER BY t.table_schema, t.table_name, c.ordinal_position`
            )
        const result: Record<string, string[]> = {}
        for (const row of tablesResult.rows) {
          const schema = row.table_schema as string
          const tbl = row.table_name as string
          const qualified = `${schema}.${tbl}`
          if (!result[tbl]) result[tbl] = []
          result[tbl].push(row.column_name as string)
          if (!result[qualified]) result[qualified] = []
          result[qualified].push(row.column_name as string)
        }
        return result
      } finally {
        if (client) await client.end().catch(() => {})
      }
    }
    case 'mariadb':
    case 'mysql': {
      const database = conn.databaseName
      if (!database) return {}
      let connection: mysql.Connection | undefined
      try {
        const cfg: mysql.ConnectionOptions =
          conn.inputMode === 'url' && conn.url
            ? (() => {
                const u = new URL(conn.url.replace(/^jdbc:/i, ''))
                return {
                  host: u.hostname,
                  port: Number(u.port) || 3306,
                  database: u.pathname.slice(1) || undefined,
                  user: conn.username ?? undefined,
                  password: conn.password || undefined
                }
              })()
            : {
                host: conn.host ?? undefined,
                port: conn.port ?? undefined,
                database,
                user: conn.username ?? undefined,
                password: conn.password || undefined
              }
        connection = await mysql.createConnection(cfg)
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT t.TABLE_NAME, c.COLUMN_NAME
           FROM information_schema.TABLES t
           JOIN information_schema.COLUMNS c
             ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
           WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
           ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`,
          [database]
        )
        const result: Record<string, string[]> = {}
        for (const row of rows) {
          const tbl = row.TABLE_NAME as string
          if (!result[tbl]) result[tbl] = []
          result[tbl].push(row.COLUMN_NAME as string)
        }
        return result
      } finally {
        if (connection) await connection.end().catch(() => {})
      }
    }
    case 'sqlite': {
      const filePath = conn.filePath
      if (!filePath) return {}
      const db = new Database(filePath, { readonly: true })
      try {
        const tables = db
          .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name`)
          .all() as { name: string }[]
        const result: Record<string, string[]> = {}
        for (const { name } of tables) {
          const cols = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as { name: string }[]
          result[name] = cols.map((c) => c.name)
        }
        return result
      } finally {
        db.close()
      }
    }
    default:
      return {}
  }
}

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

function pgOidToCategory(oid: number): string {
  if ([16].includes(oid)) return 'boolean'
  if ([20, 21, 23, 26, 700, 701, 790, 1700].includes(oid)) return 'numeric'
  if ([1082, 1083, 1114, 1184, 1186].includes(oid)) return 'datetime'
  return 'string'
}

function mysqlTypeToCategory(type: number): string {
  if ([0, 1, 2, 3, 4, 5, 8, 9, 13, 16, 246].includes(type)) return 'numeric'
  if ([7, 10, 11, 12, 14].includes(type)) return 'datetime'
  return 'string'
}

function sqliteTypeToCategory(type: string | null): string {
  if (!type) return 'string'
  const t = type.toUpperCase()
  if (/\bBOOL/.test(t)) return 'boolean'
  if (/INT|REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC/.test(t)) return 'numeric'
  if (/DATE|TIME/.test(t)) return 'datetime'
  return 'string'
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
      let client: PgClient | undefined
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
    case 'mariadb':
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
      let client: PgClient | undefined
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
      let client: PgClient | undefined
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
      let client: PgClient | undefined
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
      let client: PgClient | undefined
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
