import * as fs from 'fs'
import Papa from 'papaparse'
import Database from 'better-sqlite3'
import { getConnWithSsh, buildPgConfig, buildMysqlConfig, PgClient, mysql } from './connection-utils'

export interface CsvPreviewResult {
  headers: string[]
  preview: Record<string, string>[]
  totalEstimated: number
}

export interface CsvImportParams {
  connectionId: number
  schemaName?: string
  tableName: string
  filePath: string
  columnMapping: Record<string, string | null>
  columnTypes: Record<string, string>
  skipFirstRow: boolean
  batchSize?: number
}

const DATE_TYPE_PATTERN = /timestamp|datetime|date|time/i

function normalizeValue(val: string | undefined, colType: string | undefined, dbType: string): string | null {
  if (val == null || val === '') return null
  if (colType && DATE_TYPE_PATTERN.test(colType)) {
    const d = new Date(val)
    if (!isNaN(d.getTime())) {
      if (dbType === 'mysql' || dbType === 'mariadb') {
        // MySQL: "YYYY-MM-DD HH:MM:SS.ffffff" (T, Z 불허)
        return d.toISOString().replace('T', ' ').slice(0, -1)
      }
      // PostgreSQL, SQLite: ISO 8601
      return d.toISOString()
    }
  }
  return val
}

export function previewCsv(filePath: string): CsvPreviewResult {
  const content = fs.readFileSync(filePath, 'utf-8')
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    preview: 100,
    skipEmptyLines: true,
  })

  const headers = result.meta.fields ?? []
  const preview = result.data.slice(0, 5)

  const stats = fs.statSync(filePath)
  const totalLines = content.split('\n').length
  const avgLineSize = totalLines > 0 ? stats.size / totalLines : 100
  const totalEstimated = Math.max(0, Math.round(stats.size / avgLineSize) - 1)

  return { headers, preview, totalEstimated }
}

export async function importCsvToTable(
  params: CsvImportParams,
  onProgress: (done: number) => void
): Promise<{ insertedRows: number }> {
  const { connectionId, schemaName, tableName, filePath, columnMapping, columnTypes, skipFirstRow, batchSize = 500 } = params

  const mappedCols = Object.entries(columnMapping)
    .filter(([, tableCol]) => tableCol !== null)
    .map(([csvHeader, tableCol]) => ({ csvHeader, tableCol: tableCol as string, colType: columnTypes[tableCol as string] }))

  if (mappedCols.length === 0) throw new Error('매핑된 컬럼이 없습니다.')

  const conn = await getConnWithSsh(connectionId)

  if (conn.dbType === 'postgresql') {
    return importPostgres(conn, schemaName, tableName, filePath, mappedCols, skipFirstRow, batchSize, conn.dbType, onProgress)
  } else if (conn.dbType === 'mysql' || conn.dbType === 'mariadb') {
    return importMysql(conn, schemaName, tableName, filePath, mappedCols, skipFirstRow, batchSize, conn.dbType, onProgress)
  } else if (conn.dbType === 'sqlite') {
    return importSqlite(conn, tableName, filePath, mappedCols, skipFirstRow, batchSize, conn.dbType, onProgress)
  } else {
    throw new Error('지원하지 않는 DB 유형입니다.')
  }
}

function parseCsvRows(
  filePath: string,
  skipFirstRow: boolean
): { headers: string[]; rows: string[][] } {
  const content = fs.readFileSync(filePath, 'utf-8')
  const result = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: true,
  })

  const allRows = result.data
  if (allRows.length === 0) return { headers: [], rows: [] }

  const headers = allRows[0] as string[]
  const dataRows = skipFirstRow ? allRows.slice(1) : allRows.slice(1)
  return { headers, rows: dataRows as string[][] }
}

async function importPostgres(
  conn: { host: string | null; port: number | null; databaseName: string | null; username: string | null; password: string; url: string | null; inputMode: string },
  schemaName: string | undefined,
  tableName: string,
  filePath: string,
  mappedCols: { csvHeader: string; tableCol: string; colType: string | undefined }[],
  skipFirstRow: boolean,
  batchSize: number,
  dbType: string,
  onProgress: (done: number) => void
): Promise<{ insertedRows: number }> {
  const { headers, rows } = parseCsvRows(filePath, skipFirstRow)

  const headerIndex = new Map(headers.map((h, i) => [h, i]))
  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const tableRef = schemaName
    ? `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`
    : quoteIdent(tableName)
  const colList = mappedCols.map((m) => quoteIdent(m.tableCol)).join(', ')

  const client = new PgClient(buildPgConfig(conn))
  await client.connect()

  let insertedRows = 0
  try {
    await client.query('BEGIN')

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const valuePlaceholders: string[] = []
      const flatValues: (string | null)[] = []
      let paramIdx = 1

      for (const row of batch) {
        const placeholders = mappedCols.map(() => `$${paramIdx++}`)
        valuePlaceholders.push(`(${placeholders.join(', ')})`)
        for (const m of mappedCols) {
          const colIdx = headerIndex.get(m.csvHeader) ?? -1
          flatValues.push(normalizeValue(colIdx >= 0 ? row[colIdx] : undefined, m.colType, dbType))
        }
      }

      const sql = `INSERT INTO ${tableRef} (${colList}) VALUES ${valuePlaceholders.join(', ')}`
      await client.query(sql, flatValues)
      insertedRows += batch.length
      onProgress(insertedRows)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end().catch(() => {})
  }

  return { insertedRows }
}

async function importMysql(
  conn: { host: string | null; port: number | null; databaseName: string | null; username: string | null; password: string; url: string | null; inputMode: string },
  schemaName: string | undefined,
  tableName: string,
  filePath: string,
  mappedCols: { csvHeader: string; tableCol: string; colType: string | undefined }[],
  skipFirstRow: boolean,
  batchSize: number,
  dbType: string,
  onProgress: (done: number) => void
): Promise<{ insertedRows: number }> {
  const { headers, rows } = parseCsvRows(filePath, skipFirstRow)

  const headerIndex = new Map(headers.map((h, i) => [h, i]))
  const quoteIdent = (s: string): string => '`' + s.replace(/`/g, '``') + '`'
  const tableRef = schemaName
    ? `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`
    : quoteIdent(tableName)
  const colList = mappedCols.map((m) => quoteIdent(m.tableCol)).join(', ')

  const connection = await mysql.createConnection(buildMysqlConfig(conn))
  let insertedRows = 0
  try {
    await connection.beginTransaction()

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const valuePlaceholders: string[] = []
      const flatValues: (string | null)[] = []

      for (const row of batch) {
        valuePlaceholders.push(`(${mappedCols.map(() => '?').join(', ')})`)
        for (const m of mappedCols) {
          const colIdx = headerIndex.get(m.csvHeader) ?? -1
          flatValues.push(normalizeValue(colIdx >= 0 ? row[colIdx] : undefined, m.colType, dbType))
        }
      }

      const sql = `INSERT INTO ${tableRef} (${colList}) VALUES ${valuePlaceholders.join(', ')}`
      await connection.execute(sql, flatValues)
      insertedRows += batch.length
      onProgress(insertedRows)
    }

    await connection.commit()
  } catch (err) {
    await connection.rollback().catch(() => {})
    throw err
  } finally {
    await connection.end().catch(() => {})
  }

  return { insertedRows }
}

async function importSqlite(
  conn: { filePath: string | null },
  tableName: string,
  filePath: string,
  mappedCols: { csvHeader: string; tableCol: string; colType: string | undefined }[],
  skipFirstRow: boolean,
  batchSize: number,
  dbType: string,
  onProgress: (done: number) => void
): Promise<{ insertedRows: number }> {
  if (!conn.filePath) throw new Error('SQLite 파일 경로가 없습니다.')

  const { headers, rows } = parseCsvRows(filePath, skipFirstRow)
  const headerIndex = new Map(headers.map((h, i) => [h, i]))
  const quoteIdent = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
  const colList = mappedCols.map((m) => quoteIdent(m.tableCol)).join(', ')
  const placeholders = mappedCols.map(() => '?').join(', ')
  const sql = `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders})`

  const db = new Database(conn.filePath)
  let insertedRows = 0
  try {
    const stmt = db.prepare(sql)
    const insertBatch = db.transaction((batch: string[][]) => {
      for (const row of batch) {
        const values = mappedCols.map((m) => {
          const colIdx = headerIndex.get(m.csvHeader) ?? -1
          return normalizeValue(colIdx >= 0 ? row[colIdx] : undefined, m.colType, dbType)
        })
        stmt.run(values)
      }
    })

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      insertBatch(batch)
      insertedRows += batch.length
      onProgress(insertedRows)
    }
  } finally {
    db.close()
  }

  return { insertedRows }
}
