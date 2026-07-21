import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = new Map<string, string>()
const open = vi.fn(async () => undefined)
const execute = vi.fn(async () => ({ changes: { changes: 0 } }))
const query = vi.fn(async (_statement: string, values: string[]) => ({
  values: [...database.entries()]
    .filter(([key]) => key.startsWith(`${values[0]}:`))
    .map(([, payload]) => ({ payload })),
}))
const run = vi.fn(async (_statement: string, values: string[]) => {
  database.set(values[0], values[4])
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
    expect(query).toHaveBeenCalledTimes(5)
  })

  it('reads values written before a simulated process restart', async () => {
    const { LocalRepository } = await import('../db/repository')
    const firstProcess = new LocalRepository()
    await firstProcess.put('preferences', 'main', { darkMode: true })

    const secondProcess = new LocalRepository()
    await expect(secondProcess.list<{ darkMode: boolean }>('preferences')).resolves.toEqual([{ darkMode: true }])
  })
})
