import { afterEach, describe, expect, it } from 'vitest'
import { repository } from '../db/repository'
import { createLanCryptoIdentity, decryptLanSnapshot, encryptLanSnapshot, mergeLanSyncSnapshot, snapshotEntityCount } from '../services/lanSync'
import type { LanSyncSnapshot } from '../types'

const snapshot: LanSyncSnapshot = {
  version: 1,
  deviceName: '测试手机',
  createdAt: '2026-07-29T02:00:00.000Z',
  events: [{
    id: 'event-1',
    title: '治疗',
    type: 'chemotherapy',
    startDate: '2026-07-29',
    endDate: '2026-07-29',
    hospital: '',
    department: '',
    notes: '',
    allDay: true,
    tags: [],
    linkedRecordIds: [],
    createdAt: '2026-07-29T01:00:00.000Z',
    updatedAt: '2026-07-29T01:00:00.000Z',
  }],
  chemotherapyTemplates: [],
  records: [],
  pins: [],
  reimbursementPlans: [],
  assets: [],
  tombstones: [],
}

describe('LAN sync encryption', () => {
  afterEach(async () => {
    for (const kind of ['event', 'chemotherapyTemplate', 'record', 'pin', 'reimbursementPlan', 'asset', 'syncTombstone'] as const) {
      await repository.replaceKind(kind, [])
    }
  })

  it('round-trips a snapshot with automatically negotiated device keys', async () => {
    const sender = await createLanCryptoIdentity()
    const receiver = await createLanCryptoIdentity()
    const envelope = await encryptLanSnapshot(snapshot, sender, receiver.publicKey)
    await expect(decryptLanSnapshot(envelope, receiver)).resolves.toEqual(snapshot)
    const response = await encryptLanSnapshot(snapshot, receiver, envelope.senderPublicKey)
    await expect(decryptLanSnapshot(response, sender)).resolves.toEqual(snapshot)
    expect(envelope.data).not.toContain('治疗')
    expect(snapshotEntityCount(snapshot)).toBe(1)
  })

  it('rejects a snapshot sent to a different device key', async () => {
    const sender = await createLanCryptoIdentity()
    const receiver = await createLanCryptoIdentity()
    const otherDevice = await createLanCryptoIdentity()
    const envelope = await encryptLanSnapshot(snapshot, sender, receiver.publicKey)
    await expect(decryptLanSnapshot(envelope, otherDevice)).rejects.toThrow('设备密钥不匹配')
  })

  it('keeps the union of arrays while newer scalar fields win', async () => {
    await repository.put('event', 'event-1', {
      ...snapshot.events[0],
      title: '本机标题',
      tags: ['本机'],
      updatedAt: '2026-07-29T01:00:00.000Z',
    })
    const incoming: LanSyncSnapshot = {
      ...snapshot,
      events: [{
        ...snapshot.events[0],
        title: '对方较新标题',
        tags: ['对方'],
        updatedAt: '2026-07-29T03:00:00.000Z',
      }],
    }

    const merged = await mergeLanSyncSnapshot(incoming)
    expect(merged.events[0].title).toBe('对方较新标题')
    expect(merged.events[0].tags).toEqual(['本机', '对方'])
    expect(merged.summary.conflictsMerged).toBe(1)
  })
})
