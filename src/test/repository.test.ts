import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = new Map<string, string>()
const open = vi.fn(async () => undefined)
const execute = vi.fn(async () => ({ changes: { changes: 0 } }))
const query = vi.fn(async (statement: string, values: string[]) => {
  if (statement.includes('COUNT(*)')) {
    const count = [...database.entries()].filter(([key, payload]) =>
      key.startsWith(`${values[0]}:`) && String(payload).includes('data:image'),
    ).length
    return { values: [{ count }] }
  }
  if (statement.includes('SELECT payload') && statement.includes('json_extract')) {
    return {
      values: [...database.entries()]
        .filter(([key, payload]) => key.startsWith(`${values[0]}:`) && !JSON.parse(payload).image?.dataUrl)
        .map(([, payload]) => ({ payload })),
    }
  }
  if (statement.includes('SELECT entity_id')) {
    return {
      values: [...database.keys()]
        .filter((key) => {
          if (!key.startsWith(`${values[0]}:`)) return false
          if (!statement.includes('json_extract')) return true
          return Boolean(JSON.parse(database.get(key) ?? '{}').image?.dataUrl)
        })
        .map((key) => ({ entity_id: key.slice(key.indexOf(':') + 1) })),
    }
  }
  if (statement.includes('AND entity_id')) {
    const payload = database.get(`${values[0]}:${values[1]}`)
    return { values: payload === undefined ? [] : [{ payload }] }
  }
  return {
    values: [...database.entries()]
      .filter(([key]) => key.startsWith(`${values[0]}:`))
      .map(([, payload]) => ({ payload })),
  }
})
const run = vi.fn(async (statement: string, values: string[]) => {
  if (statement.startsWith('DELETE')) database.delete(values[0])
  else database.set(values[0], values[4])
  return { changes: { changes: 1 } }
})
const nativeDb = {
  isDBOpen: vi.fn(async () => ({ result: false })),
  open,
  execute,
  query,
  run,
}
const createConnection = vi.fn(async () => nativeDb)

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    checkConnectionsConsistency = vi.fn(async () => ({ result: true }))
    isConnection = vi.fn(async () => ({ result: false }))
    createConnection = createConnection
    retrieveConnection = vi.fn(async () => nativeDb)
  },
}))

describe('Android SQLite repository', () => {
  beforeEach(() => {
    database.clear()
    vi.clearAllMocks()
  })

  it('shares one initialization across concurrent startup reads', async () => {
    const { LocalRepository } = await import('../db/repository')
    const repository = new LocalRepository()

    await Promise.all([
      repository.list('event'),
      repository.list('record'),
      repository.list('pin'),
      repository.list('preferences'),
      repository.list('ocrJob'),
    ])

    expect(createConnection).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(7)
  })

  it('reads values written before a simulated process restart', async () => {
    const { LocalRepository } = await import('../db/repository')
    const firstProcess = new LocalRepository()
    await firstProcess.put('preferences', 'main', { darkMode: true })

    const secondProcess = new LocalRepository()
    await expect(secondProcess.list<{ darkMode: boolean }>('preferences')).resolves.toEqual([{ darkMode: true }])
  })

  it('records deletions for sync and clears the marker when the entity is saved again', async () => {
    const { LocalRepository } = await import('../db/repository')
    const repository = new LocalRepository()
    await repository.put('event', 'event-1', { id: 'event-1', updatedAt: '2026-07-29T01:00:00.000Z' })
    await repository.remove('event', 'event-1')

    await expect(repository.list<{ entityId: string }>('syncTombstone')).resolves.toEqual([
      expect.objectContaining({ entityId: 'event-1' }),
    ])

    await repository.put('event', 'event-1', { id: 'event-1', updatedAt: '2026-07-29T02:00:00.000Z' })
    await expect(repository.list('syncTombstone')).resolves.toEqual([])
  })

  it('reads image-heavy records one row per native bridge response', async () => {
    const { LocalRepository } = await import('../db/repository')
    database.set('record:first', JSON.stringify({ id: 'first', images: [{ dataUrl: 'data:image/jpeg;base64,large-image-1' }] }))
    database.set('record:second', JSON.stringify({ id: 'second', images: [{ dataUrl: 'data:image/jpeg;base64,large-image-2' }] }))

    const repository = new LocalRepository()
    await expect(repository.list<{ id: string }>('record')).resolves.toEqual([
      expect.objectContaining({ id: 'first' }),
      expect.objectContaining({ id: 'second' }),
    ])

    expect(query).toHaveBeenCalledTimes(4)
    expect(query.mock.calls[0][0]).toContain('COUNT(*)')
    expect(query.mock.calls[1][0]).toContain('SELECT entity_id')
    expect(query.mock.calls.slice(2).every(([statement]) => statement.includes('LIMIT 1'))).toBe(true)
  })

  it('reads migrated record metadata in one batch after the legacy image check', async () => {
    const { LocalRepository } = await import('../db/repository')
    database.set('record:first', JSON.stringify({ id: 'first', images: [{ dataUrl: '', storagePath: 'report-images/one.jpg' }] }))
    database.set('record:second', JSON.stringify({ id: 'second', images: [{ dataUrl: '', storagePath: 'report-images/two.jpg' }] }))

    const repository = new LocalRepository()
    await expect(repository.list<{ id: string }>('record')).resolves.toEqual([
      expect.objectContaining({ id: 'first' }),
      expect.objectContaining({ id: 'second' }),
    ])

    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0]).toContain('COUNT(*)')
    expect(query.mock.calls[1][0]).toContain('SELECT payload')
  })

  it('migrates legacy record dates to sampleDate without retaining ambiguous fields', async () => {
    const { LocalRepository } = await import('../db/repository')
    database.set('record:legacy', JSON.stringify({
      id: 'legacy',
      examDate: '2026-07-18',
      reportDate: '2026-07-20',
      images: [],
    }))

    const repository = new LocalRepository()
    const [record] = await repository.list<Record<string, unknown>>('record')

    expect(record.sampleDate).toBe('2026-07-18')
    expect(record).not.toHaveProperty('examDate')
    expect(record).not.toHaveProperty('reportDate')
  })

  it('does not promote a legacy report date when no sampling date exists', async () => {
    const { LocalRepository } = await import('../db/repository')
    database.set('record:legacy', JSON.stringify({
      id: 'legacy',
      reportDate: '2026-07-20',
      images: [],
    }))

    const repository = new LocalRepository()
    const [record] = await repository.list<Record<string, unknown>>('record')

    expect(record.sampleDate).toBe('')
    expect(record).not.toHaveProperty('reportDate')
  })

  it('restores lightweight folder jobs in one bridge response and keeps base64 jobs isolated', async () => {
    const { LocalRepository } = await import('../db/repository')
    for (let index = 0; index < 120; index += 1) {
      database.set(`ocrJob:folder-${index}`, JSON.stringify({ id: `folder-${index}`, image: { dataUrl: '', sourceUri: `content://${index}` } }))
    }
    database.set('ocrJob:camera', JSON.stringify({ id: 'camera', image: { dataUrl: 'data:image/jpeg;base64,large' } }))

    const repository = new LocalRepository()
    const jobs = await repository.list<{ id: string }>('ocrJob')

    expect(jobs).toHaveLength(121)
    expect(query).toHaveBeenCalledTimes(3)
    expect(query.mock.calls[0][0]).toContain('SELECT payload')
    expect(query.mock.calls[0][0]).toContain('json_extract')
    expect(query.mock.calls[2][0]).toContain('LIMIT 1')
  })
})
