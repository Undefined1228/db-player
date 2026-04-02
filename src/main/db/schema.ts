import { getConnWithSsh, buildPgConfig, buildMysqlConfig, PgClient, mysql } from './connection-utils'

export interface SchemaInfo {
  name: string
  owned: boolean
}

export async function getRoles(connectionId: number): Promise<string[]> {
  const conn = await getConnWithSsh(connectionId)
  if (conn.dbType !== 'postgresql') throw new Error('PostgreSQL에서만 지원됩니다.')

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
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

  let client: InstanceType<typeof PgClient> | undefined
  try {
    client = new PgClient(buildPgConfig(conn))
    await client.connect()
    await client.query(sql)
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

  let client: InstanceType<typeof PgClient> | undefined
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
