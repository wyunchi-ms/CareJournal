import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarPage } from '../pages/CalendarPage'
import { AppProvider, useApp } from '../store/AppContext'
import type { ExamRecord, TreatmentEvent } from '../types'

const { stored, putMany } = vi.hoisted(() => ({ stored: new Map<string, unknown>(), putMany: vi.fn() }))
vi.mock('../db/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../db/repository')>(),
  repository: {
    native: false,
    removePersistedCompletedOcrJobs: vi.fn(),
    list: vi.fn(async (kind: string) => [...stored.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => value)),
    put: vi.fn(async (kind: string, id: string, payload: unknown) => { stored.set(`${kind}:${id}`, payload) }),
    remove: vi.fn(async (kind: string, id: string) => { stored.delete(`${kind}:${id}`) }),
    putMany,
  },
}))

function report(id: string, sampleDate: string): ExamRecord {
  return {
    id, reportType: '检查', sampleDate, images: [], indicators: [], linkedEventIds: [],
    fingerprint: id, ocrStatus: 'completed', ocrAttempts: 1, createdAt: '', updatedAt: '',
  }
}

function Harness() {
  const { ready, storageError, records, events, saveRecord } = useApp()
  if (storageError) return <p role="alert">{storageError}</p>
  if (!ready) return <p>loading</p>
  return <>
    <p>ready</p>
    <output data-testid="event-count">{events.length}</output>
    {records.map((record) => <button key={record.id} onClick={() => {
      void saveRecord({ ...record, linkedEventIds: [] }).catch((error: Error) => { document.title = error.message })
    }}>重新保存：{record.id}</button>)}
    {['2026-11-01', '2026-11-02', ''].map((date) => <button key={date} onClick={() => {
      void saveRecord({ ...records[0], sampleDate: date }).catch((error: Error) => { document.title = error.message })
    }}>修改日期：{date || '清空'}</button>)}
    <CalendarPage />
  </>
}

function mount() {
  return render(<MemoryRouter initialEntries={['/calendar?month=2026-11&date=2026-11-01']}><AppProvider><Harness /></AppProvider></MemoryRouter>)
}

beforeEach(() => {
  stored.clear()
  document.title = ''
  putMany.mockReset().mockImplementation(async (writes: Array<{ kind: string; id: string; payload: unknown }>) => {
    for (const write of writes) stored.set(`${write.kind}:${write.id}`, write.payload)
  })
})

describe('report dates and calendar persistence', () => {
  it('leaves existing data untouched on startup and creates persistent calendar links only when corrected reports are saved again', async () => {
    stored.set('record:first', report('first', '2026-11-01'))
    stored.set('record:second', report('second', '2026-11-02'))
    stored.set('record:undated', report('undated', ''))
    const view = mount()
    await screen.findByText('ready')
    expect(putMany).not.toHaveBeenCalled()
    expect(screen.getByTestId('event-count')).toHaveTextContent('0')
    expect(stored.get('record:first')).toMatchObject({ linkedEventIds: [] })
    fireEvent.click(screen.getByRole('button', { name: '重新保存：first' }))
    await screen.findByRole('button', { name: '11月1日，1 个事件' })
    fireEvent.click(screen.getByRole('button', { name: '重新保存：second' }))
    await screen.findByRole('button', { name: '11月2日，1 个事件' })
    expect(screen.getByRole('button', { name: '11月1日，1 个事件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '11月2日，1 个事件' })).toBeInTheDocument()
    expect(screen.getByTestId('event-count')).toHaveTextContent('2')
    const eventIds = [...stored.keys()].filter((key) => key.startsWith('event:'))
    for (const id of ['first', 'second']) {
      const record = stored.get(`record:${id}`) as ExamRecord
      const event = stored.get(`event:${record.linkedEventIds[0]}`) as TreatmentEvent
      expect(event.linkedRecordIds).toEqual([id])
      expect(event.startDate).toBe(record.sampleDate)
    }
    const firstLink = (stored.get('record:first') as ExamRecord).linkedEventIds[0]
    fireEvent.click(screen.getByRole('button', { name: '重新保存：first' }))
    await waitFor(() => expect(putMany).toHaveBeenCalledTimes(3))
    expect(stored.get('record:first')).toMatchObject({ linkedEventIds: [firstLink] })
    expect(screen.getByTestId('event-count')).toHaveTextContent('2')
    expect(stored.get('record:undated')).toMatchObject({ linkedEventIds: [] })
    view.unmount()
    putMany.mockClear()
    mount()
    await screen.findByText('ready')
    expect(screen.getByTestId('event-count')).toHaveTextContent('2')
    expect([...stored.keys()].filter((key) => key.startsWith('event:'))).toEqual(eventIds)
    expect(putMany).not.toHaveBeenCalled()
  })

  it('creates an event when an unrecognized date is corrected, moves it on later edits and removes it when the date is cleared', async () => {
    stored.set('record:undated', report('undated', ''))
    mount()
    await screen.findByText('ready')
    expect(putMany).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '修改日期：2026-11-01' }))
    await screen.findByRole('button', { name: '11月1日，1 个事件' })
    expect(putMany.mock.calls[0][0].map((write: { kind: string }) => write.kind)).toEqual(['record', 'event'])
    const linked = stored.get('record:undated') as ExamRecord
    const eventId = linked.linkedEventIds[0]
    expect(stored.get(`event:${eventId}`)).toMatchObject({ startDate: '2026-11-01', linkedRecordIds: ['undated'] })
    fireEvent.click(screen.getByRole('button', { name: '修改日期：2026-11-02' }))
    await screen.findByRole('button', { name: '11月2日，1 个事件' })
    expect(screen.getByRole('button', { name: '11月1日，无事件' })).toBeInTheDocument()
    expect(screen.getByTestId('event-count')).toHaveTextContent('1')
    expect(stored.get('record:undated')).toMatchObject({ linkedEventIds: [eventId], sampleDate: '2026-11-02' })
    expect(stored.get(`event:${eventId}`)).toMatchObject({ startDate: '2026-11-02', endDate: '2026-11-02' })
    fireEvent.click(screen.getByRole('button', { name: '修改日期：清空' }))
    await waitFor(() => expect(screen.getByTestId('event-count')).toHaveTextContent('0'))
    expect(stored.get('record:undated')).toMatchObject({ linkedEventIds: [], sampleDate: '' })
    expect(stored.has(`event:${eventId}`)).toBe(false)
  })

  it('does not recreate deliberately deleted calendar events', async () => {
    stored.set('record:deleted', { ...report('deleted', '2026-11-01'), linkedEventIds: ['deleted-event'] })
    mount()
    await screen.findByText('ready')
    expect(screen.getByRole('button', { name: '11月1日，无事件' })).toBeInTheDocument()
    expect(putMany).not.toHaveBeenCalled()
  })
})
