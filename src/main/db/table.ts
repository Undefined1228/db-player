import { getConnWithSsh, buildPgConfig, buildMysqlConfig, PgClient, mysql } from './connection-utils'
import { buildPostgresDDL, buildAlterTableDDL, buildMysqlDDL, buildAlterTableMysqlDDL, type CreateTableParams, type AlterTableParams, type CreateTableColumnDef, type CreateTableFKDef } from './ddl-builder'

export type { CreateTableParams, AlterTableParams }

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

function formatDataType(row: Record<string, unknown>): string {
  const udt = row.udt_name as string
  const charLen = row.character_maximum_length as number | null
  const numPrec = row.numeric_precision as number | null
  const numScale = row.numeric_scale as number | null

  if (charLen) return `${udt}(${charLen})`
  if (numPrec && numScale && numScale > 0) return `numeric(${numPrec},${numScale})`
  return udt
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

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
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

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    const ddl = buildMysqlDDL(params)
    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      await connection.query(ddl)
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
    return
  }

  if (conn.dbType !== 'postgresql') throw new Error(`${conn.dbType} 테이블 생성은 아직 지원되지 않습니다.`)

  const ddl = buildPostgresDDL(params)

  let client: InstanceType<typeof PgClient> | undefined
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

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    const statements = buildAlterTableMysqlDDL(params)
    if (statements.length === 0) return
    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      await connection.beginTransaction()
      for (const sql of statements) {
        await connection.query(sql)
      }
      await connection.commit()
    } catch (err) {
      if (connection) await connection.rollback().catch(() => {})
      throw err
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
    return
  }

  if (conn.dbType !== 'postgresql') throw new Error(`${conn.dbType} 테이블 수정은 아직 지원되지 않습니다.`)

  const statements = buildAlterTableDDL(params)
  if (statements.length === 0) return

  let client: InstanceType<typeof PgClient> | undefined
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
           WHERE table_schema = ? AND table_name IN (${inPlaceholders(tableNames)}) AND constraint_name = 'PRIMARY'
           ORDER BY table_name, ordinal_position`,
          tableNames.length > 0 ? [db, ...tableNames] : [db, '__none__']
        ),
        connection.query<mysql.RowDataPacket[]>(
          `SELECT
             kcu.table_name, kcu.constraint_name, kcu.column_name AS local_column,
             kcu.referenced_table_schema AS ref_schema,
             kcu.referenced_table_name AS ref_table,
             kcu.referenced_column_name AS ref_column,
             rc.delete_rule, rc.update_rule
           FROM information_schema.key_column_usage kcu
           JOIN information_schema.referential_constraints rc
             ON rc.constraint_name = kcu.constraint_name
             AND rc.constraint_schema = kcu.table_schema
           WHERE kcu.table_schema = ? AND kcu.table_name IN (${inPlaceholders(tableNames)})
             AND kcu.referenced_table_name IS NOT NULL
           ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position`,
          tableNames.length > 0 ? [db, ...tableNames] : [db, '__none__']
        ),
        connection.query<mysql.RowDataPacket[]>(
          `SELECT
             s.table_name, s.index_name, s.non_unique, s.column_name, s.seq_in_index
           FROM information_schema.statistics s
           WHERE s.table_schema = ? AND s.table_name IN (${inPlaceholders(tableNames)})
           ORDER BY s.table_name, s.index_name, s.seq_in_index`,
          tableNames.length > 0 ? [db, ...tableNames] : [db, '__none__']
        )
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

      const indexesByTable = new Map<string, Map<string, IndexInfo>>()
      for (const r of indexRows) {
        const tbl = r.table_name as string
        const idxName = r.index_name as string
        if (!indexesByTable.has(tbl)) indexesByTable.set(tbl, new Map())
        const tblMap = indexesByTable.get(tbl)!
        if (!tblMap.has(idxName)) {
          tblMap.set(idxName, { name: idxName, unique: r.non_unique === 0, columns: [] })
        }
        tblMap.get(idxName)!.columns.push(r.column_name as string)
      }

      const tables: TableInfo[] = tableNames.map((name) => ({
        name,
        columns: columnsByTable.get(name) ?? [],
        indexes: Array.from(indexesByTable.get(name)?.values() ?? []),
        sequences: [],
        foreignKeys: fksByTable.get(name) ?? []
      }))

      const views: ViewInfo[] = viewNames.map((name) => ({
        name,
        columns: columnsByTable.get(name) ?? []
      }))

      return { tables, views, materialized_views: [], functions: [] }
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') throw new Error('지원하지 않는 DB 유형입니다.')

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
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
