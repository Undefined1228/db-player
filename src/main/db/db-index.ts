import { getConnWithSsh, buildPgConfig, PgClient } from './connection-utils'

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

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
  } finally {
    if (client) await client.end().catch(() => {})
  }
}
