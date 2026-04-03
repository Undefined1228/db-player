import { getConnWithSsh, buildPgConfig, buildMysqlConfig, PgClient, mysql } from './connection-utils'

export interface SelectAllParams {
  limit: number
  offset: number
  orderBy: { col: string; dir: 'asc' | 'desc' }[]
  search: string
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

export async function selectAll(
  connectionId: number,
  schemaName: string,
  tableName: string,
  params: SelectAllParams
): Promise<{ columns: string[]; primaryKeys: string[]; rows: Record<string, unknown>[]; totalCount: number; columnDefaults: Record<string, string | null>; columnTypes: Record<string, string> }> {
  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    const quoteIdent = (s: string): string => '`' + s.replace(/`/g, '``') + '`'
    const tableRef = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`

    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))

      const [[colRows], [pkRows]] = await Promise.all([
        connection.query<mysql.RowDataPacket[]>(
          `SELECT column_name AS col_name, column_default AS col_default, column_type AS col_type
           FROM information_schema.columns
           WHERE table_schema = ? AND table_name = ?
           ORDER BY ordinal_position`,
          [schemaName, tableName]
        ),
        connection.query<mysql.RowDataPacket[]>(
          `SELECT column_name AS col_name
           FROM information_schema.key_column_usage
           WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'
           ORDER BY ordinal_position`,
          [schemaName, tableName]
        )
      ])

      const columnNames = colRows.map((r) => r['col_name'] as string)
      const columnDefaults: Record<string, string | null> = {}
      const columnTypes: Record<string, string> = {}
      for (const r of colRows) {
        columnDefaults[r['col_name'] as string] = r['col_default'] as string | null
        columnTypes[r['col_name'] as string] = r['col_type'] as string
      }
      const primaryKeys = pkRows.map((r) => r['col_name'] as string)

      const searchPattern = params.search ? `%${params.search}%` : null
      const searchArgs: unknown[] = []
      const whereClause =
        searchPattern && columnNames.length > 0
          ? `WHERE (${columnNames.map((col) => { searchArgs.push(searchPattern); return `CAST(${quoteIdent(col)} AS CHAR) LIKE ?` }).join(' OR ')})`
          : ''

      const [countRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM ${tableRef} ${whereClause}`,
        searchArgs
      )
      const totalCount = Number(countRows[0]?.count ?? 0)

      const orderClause =
        params.orderBy.length > 0
          ? `ORDER BY ${params.orderBy.map(({ col, dir }) => `${quoteIdent(col)} ${dir === 'desc' ? 'DESC' : 'ASC'}`).join(', ')}`
          : ''

      const dataArgs = [...searchArgs]
      let limitClause = ''
      if (params.limit > 0) {
        limitClause = 'LIMIT ? OFFSET ?'
        dataArgs.push(params.limit, params.offset)
      }

      const sql = [`SELECT * FROM ${tableRef}`, whereClause, orderClause, limitClause]
        .filter(Boolean)
        .join(' ')

      const [dataRows] = await connection.query<mysql.RowDataPacket[]>(sql, dataArgs)

      return {
        columns: columnNames,
        primaryKeys,
        rows: dataRows as Record<string, unknown>[],
        totalCount,
        columnDefaults,
        columnTypes,
      }
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') throw new Error('지원하지 않는 DB 유형입니다.')

  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const tableRef = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`

  let client: InstanceType<typeof PgClient> | undefined
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

export async function executeDataChanges(
  connectionId: number,
  params: DataChangesParams
): Promise<{ success: true }> {
  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    const quoteIdent = (s: string): string => '`' + s.replace(/`/g, '``') + '`'
    const isMetaKey = (k: string): boolean => k.startsWith('__')

    const { schemaName, tableName, primaryKeys, inserts, updates, deletes } = params
    const tableRef = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`

    const buildWhere = (row: Record<string, unknown>): { clause: string; values: unknown[] } => {
      const whereCols = primaryKeys.length > 0 ? primaryKeys : Object.keys(row).filter((k) => !isMetaKey(k))
      const values = whereCols.map((k) => row[k])
      const clause = whereCols.map((k) => `${quoteIdent(k)} = ?`).join(' AND ')
      return { clause, values }
    }

    let connection: mysql.Connection | undefined
    try {
      connection = await mysql.createConnection(buildMysqlConfig(conn))
      await connection.beginTransaction()

      for (const row of deletes) {
        const { clause, values } = buildWhere(row)
        await connection.query(`DELETE FROM ${tableRef} WHERE ${clause}`, values)
      }

      for (const { original, changes } of updates) {
        const setCols = Object.keys(changes).filter((k) => !isMetaKey(k))
        if (setCols.length === 0) continue
        const setClause = setCols.map((col) => `${quoteIdent(col)} = ?`).join(', ')
        const { clause: whereClause, values: whereValues } = buildWhere(original)
        const values = [...setCols.map((col) => changes[col]), ...whereValues]
        await connection.query(`UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`, values)
      }

      for (const row of inserts) {
        const cols = Object.keys(row).filter((k) => !isMetaKey(k))
        if (cols.length === 0) continue
        const colClause = cols.map((c) => quoteIdent(c)).join(', ')
        const valClause = cols.map(() => '?').join(', ')
        const values = cols.map((c) => row[c])
        await connection.query(`INSERT INTO ${tableRef} (${colClause}) VALUES (${valClause})`, values)
      }

      await connection.commit()
      return { success: true }
    } catch (err) {
      if (connection) await connection.rollback().catch(() => {})
      throw err
    } finally {
      if (connection) await connection.end().catch(() => {})
    }
  }

  if (conn.dbType !== 'postgresql') throw new Error('지원하지 않는 DB 유형입니다.')

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

  let client: InstanceType<typeof PgClient> | undefined
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
