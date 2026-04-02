import { getConnWithSsh, buildPgConfig, PgClient } from './connection-utils'

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

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}
