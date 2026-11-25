import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { exportBackup, parseBackup, restoreBackup } from './backup'
import { PasadoDatabase } from './db'

let database: PasadoDatabase
let restored: PasadoDatabase
const now = new Date(2026, 10, 25)
const exam = { id: 'main' as const, name: 'Board exam', date: '2027-03-22', passingMark: 75, hoursPerDay: 3.5 }
const subject = { id: 'pharm', name: 'Pharmacology', weight: 100, color: '#4B3FD6', order: 0 }

beforeEach(() => {
  database = new PasadoDatabase('backup-source')
  restored = new PasadoDatabase('backup-destination')
})
afterEach(async () => {
  await database.delete()
  await restored.delete()
})

it('round-trips scores, tasks, review state, plan dates and reminder settings', async () => {
  await database.saveSetup(exam, [subject], now)
  await database.addTopic(subject.id, 'Interactions')
  const [topic] = await database.topics.toArray()
  await database.setTopicWeak(topic.id, true)
  const [task] = await database.getTodayPlan(now, true)
  await database.setTaskDone(task, 123)
  await database.saveScore({ source: 'Mock', date: '2026-11-25', bySubject: {}, total: 80 }, undefined, now)
  await database.settings.put({ id: 'reminders', enabled: false, time: '08:30' })

  const backup = await exportBackup(database)
  await restored.saveSetup({ ...exam, name: 'Old exam' }, [{ ...subject, id: 'old' }], now)
  await restoreBackup(restored, backup)
  expect(JSON.parse(await exportBackup(restored))).toEqual(JSON.parse(backup))
  expect(await restored.subjects.get('old')).toBeUndefined()
  const [done] = await restored.getTodayPlan(now)
  expect(await restored.setTaskDone(done, undefined)).toBe(true)
  expect((await restored.topics.get(topic.id))?.lastReviewedOn).toBeUndefined()
})

it('keeps local data intact after an invalid import and accepts an empty backup', async () => {
  await database.saveSetup(exam, [subject], now)
  const raw = await exportBackup(database)
  const parsed = JSON.parse(raw)
  parsed.subjects.push(parsed.subjects[0])
  await expect(restoreBackup(database, JSON.stringify(parsed))).rejects.toThrow('valid JSON backup')
  expect(await exportBackup(database)).toBe(raw)
  expect(parseBackup(await exportBackup(restored)).exam).toBeNull()
})
