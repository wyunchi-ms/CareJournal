import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import Dexie, { type EntityTable } from 'dexie'

export type EntityKind = 'event' | 'chemotherapyTemplate' | 'record' | 'pin' | 'preferences' | 'ocrJob' | 'reimbursementPlan' | 'asset' | 'syncTombstone'

const syncableKinds = new Set<EntityKind>(['event', 'chemotherapyTemplate', 'record', 'pin', 'reimbursementPlan', 'asset'])
const datePattern = /^\d{4}-\d{2}-\d{2}$/

/**
 * Record payloads are schema-less JSON in both IndexedDB and SQLite. Normalize
 * them at the repository boundary so existing installs and restored backups
 * transparently migrate from the old ambiguous date fields.
 */
export function normalizeEntityPayload<T>(kind: EntityKind, payload: T): T {
  if (kind !== 'record' || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const legacy = payload as Record<string, unknown>
  const currentDate = typeof legacy.sampleDate === 'string' ? legacy.sampleDate : ''
  const legacyDate = typeof legacy.examDate === 'string' ? legacy.examDate : ''
  const candidate = datePattern.test(currentDate) ? currentDate : legacyDate
  const sampleDate = datePattern.test(candidate) ? candidate : ''
  const record = { ...legacy }
  delete record.examDate
  delete record.reportDate
  return { ...record, sampleDate } as T
}

interface StoredEntity<T = unknown> {
  key: string
  kind: EntityKind
  id: string
  updatedAt: string
  payload: T
}

class CareJournalDexie extends Dexie {
  entities!: EntityTable<StoredEntity, 'key'>

  constructor() {
    super('carejournal')
    this.version(1).stores({ entities: '&key, kind, id, updatedAt' })
  }
}

export class LocalRepository {
  private webDb = new CareJournalDexie()
  private sqlite?: SQLiteConnection
  private nativeDb?: SQLiteDBConnection
  private initialized = false
  private initializing?: Promise<void>
  readonly native = Capacitor.isNativePlatform()

  async init() {
    if (this.initialized) return
    if (!this.initializing) this.initializing = this.initialize()
    try {
      await this.initializing
    } catch (error) {
      // Allow a later explicit reload/retry after a transient plugin failure.
      this.initializing = undefined
      throw error
    }
  }

  private async initialize() {
    if (this.native) {
      this.sqlite = new SQLiteConnection(CapacitorSQLite)
      const consistency = await this.sqlite.checkConnectionsConsistency()
      const existing = consistency.result && (await this.sqlite.isConnection('carejournal', false)).result
      this.nativeDb = existing
        ? await this.sqlite.retrieveConnection('carejournal', false)
        : await this.sqlite.createConnection('carejournal', false, 'no-encryption', 1, false)
      const openState = await this.nativeDb.isDBOpen()
      if (!openState.result) await this.nativeDb.open()
      await this.nativeDb.execute(`
        CREATE TABLE IF NOT EXISTS entities (
          key TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
      `)
    } else {
      await this.webDb.open()
    }
    this.initialized = true
  }

  async list<T>(kind: EntityKind): Promise<T[]> {
    await this.init()
    if (!this.native) {
      const rows = await this.webDb.entities.where('kind').equals(kind).toArray()
      return rows.map((row) => normalizeEntityPayload(kind, row.payload as T))
    }
    if (kind === 'record') {
      const heavyCount = await this.nativeDb!.query(
        "SELECT COUNT(*) AS count FROM entities WHERE kind = ? AND instr(payload, 'data:image') > 0",
        [kind],
      )
      if (Number(heavyCount.values?.[0]?.count ?? 0) === 0) {
        const result = await this.nativeDb!.query(
          'SELECT payload FROM entities WHERE kind = ? ORDER BY updated_at DESC',
          [kind],
        )
        return (result.values ?? []).map((row) => normalizeEntityPayload(kind, JSON.parse(String(row.payload)) as T))
      }
      // Legacy records can still contain Base64 if native migration could not
      // process an item. Keep those rows isolated to avoid one enormous bridge
      // response while allowing migrated metadata to use the fast batch path.
      const ids = await this.nativeDb!.query(
        'SELECT entity_id FROM entities WHERE kind = ? ORDER BY updated_at DESC',
        [kind],
      )
      const values: T[] = []
      for (const row of ids.values ?? []) {
        const result = await this.nativeDb!.query(
          'SELECT payload FROM entities WHERE kind = ? AND entity_id = ? LIMIT 1',
          [kind, String(row.entity_id)],
        )
        const payload = result.values?.[0]?.payload
        if (payload !== undefined) values.push(normalizeEntityPayload(kind, JSON.parse(String(payload)) as T))
      }
      return values
    }
    if (kind === 'ocrJob') {
      // Folder imports persist only a URI and metadata, so hundreds of those
      // jobs are safe to restore together. Legacy picker/camera jobs may still
      // embed base64 and remain row-by-row to preserve the startup OOM guard.
      const lightweight = await this.nativeDb!.query(
        "SELECT payload FROM entities WHERE kind = ? AND COALESCE(length(json_extract(payload, '$.image.dataUrl')), 0) = 0 ORDER BY updated_at DESC",
        [kind],
      )
      const values = (lightweight.values ?? []).map((row) => JSON.parse(String(row.payload)) as T)
      const heavyIds = await this.nativeDb!.query(
        "SELECT entity_id FROM entities WHERE kind = ? AND COALESCE(length(json_extract(payload, '$.image.dataUrl')), 0) > 0 ORDER BY updated_at DESC",
        [kind],
      )
      for (const row of heavyIds.values ?? []) {
        const result = await this.nativeDb!.query(
          'SELECT payload FROM entities WHERE kind = ? AND entity_id = ? LIMIT 1',
          [kind, String(row.entity_id)],
        )
        const payload = result.values?.[0]?.payload
        if (payload !== undefined) values.push(JSON.parse(String(payload)) as T)
      }
      return values
    }
    const result = await this.nativeDb!.query('SELECT payload FROM entities WHERE kind = ? ORDER BY updated_at DESC', [kind])
    return (result.values ?? []).map((row) => JSON.parse(String(row.payload)) as T)
  }

  async removePersistedCompletedOcrJobs() {
    await this.init()
    if (!this.native) {
      await this.webDb.transaction('rw', this.webDb.entities, async () => {
        const completed = await this.webDb.entities
          .where('kind')
          .equals('ocrJob')
          .filter((row) => (row.payload as { status?: string }).status === 'completed')
          .primaryKeys()
        await this.webDb.entities.bulkDelete(completed)
      })
      return
    }
    // Delete in SQLite itself so old completed jobs (and their duplicate image
    // data) never have to cross the Capacitor bridge during startup cleanup.
    await this.nativeDb!.execute(
      "DELETE FROM entities WHERE kind = 'ocrJob' AND json_extract(payload, '$.status') = 'completed';",
    )
  }

  private async putStored<T>(kind: EntityKind, id: string, payload: T) {
    const normalizedPayload = normalizeEntityPayload(kind, payload)
    const updatedAt = (normalizedPayload as { updatedAt?: string }).updatedAt ?? new Date().toISOString()
    const key = `${kind}:${id}`
    if (!this.native) {
      await this.webDb.entities.put({ key, kind, id, updatedAt, payload: normalizedPayload })
      return
    }
    await this.nativeDb!.run(
      'INSERT OR REPLACE INTO entities (key, kind, entity_id, updated_at, payload) VALUES (?, ?, ?, ?, ?)',
      [key, kind, id, updatedAt, JSON.stringify(normalizedPayload)],
    )
  }

  private async removeStored(kind: EntityKind, id: string) {
    const key = `${kind}:${id}`
    if (!this.native) {
      await this.webDb.entities.delete(key)
      return
    }
    await this.nativeDb!.run('DELETE FROM entities WHERE key = ?', [key])
  }

  async put<T>(kind: EntityKind, id: string, payload: T) {
    await this.init()
    await this.putStored(kind, id, payload)
    if (syncableKinds.has(kind)) await this.removeStored('syncTombstone', `${kind}:${id}`)
  }

  async remove(kind: EntityKind, id: string) {
    await this.init()
    await this.removeStored(kind, id)
    if (syncableKinds.has(kind)) {
      const now = new Date().toISOString()
      await this.putStored('syncTombstone', `${kind}:${id}`, {
        id: `${kind}:${id}`,
        entityKind: kind,
        entityId: id,
        deletedAt: now,
        updatedAt: now,
      })
    }
  }

  async replaceKind<T>(kind: EntityKind, entries: Array<{ id: string; payload: T }>) {
    await this.init()
    if (!this.native) {
      await this.webDb.transaction('rw', this.webDb.entities, async () => {
        const keys = await this.webDb.entities.where('kind').equals(kind).primaryKeys()
        await this.webDb.entities.bulkDelete(keys)
        await this.webDb.entities.bulkPut(entries.map(({ id, payload }) => {
          const normalizedPayload = normalizeEntityPayload(kind, payload)
          return {
            key: `${kind}:${id}`,
            kind,
            id,
            updatedAt: (normalizedPayload as { updatedAt?: string }).updatedAt ?? new Date().toISOString(),
            payload: normalizedPayload,
          }
        }))
        if (syncableKinds.has(kind)) {
          await this.webDb.entities.bulkDelete(entries.map(({ id }) => `syncTombstone:${kind}:${id}`))
        }
      })
      return
    }
    await this.nativeDb!.run('DELETE FROM entities WHERE kind = ?', [kind])
    for (const { id, payload } of entries) await this.put(kind, id, payload)
  }
}

export const repository = new LocalRepository()
