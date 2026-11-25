import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { PasadoDatabase } from './db'

let database: PasadoDatabase
const now = new Date(2026, 10, 25)

beforeEach(() => {
  database = new PasadoDatabase('pasado-test')
})
afterEach(() => database.delete())

it('generates one plan per date and preserves completion across reads', async () => {
  expect(await database.getTodayPlan(now)).toEqual([])
  await database.exams.add({ id: 'main', name: 'Exam', date: '2026-12-01', passingMark: 75, hoursPerDay: 1 })
  await database.subjects.bulkAdd([
    { id: 'a', name: 'A', weight: 10, color: '#4B3FD6', order: 0 },
    { id: 'z', name: 'Z', weight: 90, color: '#1FA6A0', order: 1 },
  ])
  const [plan, concurrent] = await Promise.all([database.getTodayPlan(now), database.getTodayPlan(now)])
  expect(concurrent).toEqual(plan)
  expect(plan.map(({ subjectId }) => subjectId)).toEqual(['z', 'a'])
  await database.tasks.update(plan[0].id, { doneAt: 123 })
  await database.scores.add({ id: 'mock', source: 'Practice', bySubject: { z: 80 }, date: '2026-11-25', createdAt: 1 })
  const saved = await database.getTodayPlan(now)
  expect(saved[0]).toMatchObject({ doneAt: 123, kind: 'focus' })

  const tomorrow = new Date(2026, 10, 26)
  const next = await database.getTodayPlan(tomorrow)
  expect(next.every((task) => task.date === '2026-11-26' && task.doneAt === undefined)).toBe(true)
  expect((await database.getTodayPlan(now))[0].doneAt).toBe(123)

  const rebuilt = await database.getTodayPlan(now, true)
  expect(rebuilt.map(({ subjectId, kind }) => [subjectId, kind])).toEqual([['a', 'focus'], ['z', 'recap']])
  expect(await database.getTodayPlan(tomorrow)).toEqual(next)
})

it('invalidates only the current plan when study time or subjects change', async () => {
  const exam = { id: 'main' as const, name: 'Exam', date: '2026-12-01', passingMark: 75, hoursPerDay: 1 }
  const subject = { id: 'a', name: 'A', weight: 100, color: '#4B3FD6', order: 0 }
  await database.saveSetup(exam, [subject], now)
  const yesterday = new Date(2026, 10, 24)
  const pastPlan = await database.getTodayPlan(yesterday)
  const currentPlan = await database.getTodayPlan(now)
  await database.tasks.update(currentPlan[0].id, { doneAt: 456 })

  await database.saveSetup({ ...exam, name: 'Renamed exam' }, [subject], now)
  expect((await database.getTodayPlan(now))[0].doneAt).toBe(456)
  await database.saveSetup({ ...exam, hoursPerDay: 2 }, [subject], now)
  expect(await database.getTodayPlan(now)).toMatchObject([{ minutes: 120 }])
  expect((await database.getTodayPlan(now))[0].doneAt).toBeUndefined()
  expect(await database.getTodayPlan(yesterday)).toEqual(pastPlan)

  await database.saveSetup(exam, [{ ...subject, weight: 0 }], now)
  expect(await database.getTodayPlan(now)).toEqual([])
  await database.scores.add({ id: 'mock', source: 'Practice', bySubject: { a: 80 }, date: '2026-11-25', createdAt: 1 })
  expect(await database.getTodayPlan(now)).toEqual([])
  expect(await database.getTodayPlan(now, true)).toMatchObject([{ kind: 'recap', minutes: 60 }])
})

it('toggles task completion and rejects stale undo or writes after a rebuild', async () => {
  await database.saveSetup(
    { id: 'main', name: 'Exam', date: '2026-12-01', passingMark: 75, hoursPerDay: 1 },
    [{ id: 'a', name: 'A', weight: 100, color: '#4B3FD6', order: 0 }],
    now,
  )
  const [task] = await database.getTodayPlan(now)
  expect(await database.setTaskDone(task, 123)).toBe(true)
  expect(await database.setTaskDone(task, 124)).toBe(false)
  const [done] = await database.getTodayPlan(now)
  expect(done.doneAt).toBe(123)
  expect(await database.setTaskDone(done, undefined)).toBe(true)
  expect((await database.getTodayPlan(now))[0].doneAt).toBeUndefined()
  expect(await database.setTaskDone(task, 125)).toBe(true)
  expect(await database.setTaskDone(done, undefined)).toBe(false)
  await database.getTodayPlan(now, true)
  expect(await database.setTaskDone({ ...task, doneAt: 125 }, undefined)).toBe(false)
})

it('saves and edits score entries without resetting their creation time', async () => {
  await database.saveScore({ source: '  Mock A  ', date: '2026-11-25', bySubject: { a: 0 }, total: 90 }, undefined, now)
  const [score] = await database.scores.toArray()
  expect(score).toMatchObject({ source: 'Mock A', bySubject: { a: 0 }, createdAt: now.getTime() })
  expect(score.total).toBeUndefined()
  await database.saveScore({ source: 'Mock B', date: '2026-11-24', bySubject: {}, total: 82.5 }, score.id, now)
  expect(await database.scores.get(score.id)).toEqual({
    id: score.id, source: 'Mock B', date: '2026-11-24', bySubject: {}, total: 82.5, createdAt: now.getTime(),
  })
  await database.scores.delete(score.id)
  await expect(database.saveScore(score, score.id, now)).rejects.toThrow('already removed')
  expect(await database.scores.count()).toBe(0)
})

it('rejects absent, invalid, and future-dated scores', () => {
  const fields = { source: 'Practice', date: '2026-11-25', bySubject: {} }
  expect(() => database.saveScore(fields, undefined, now)).toThrow(RangeError)
  expect(() => database.saveScore({ ...fields, total: 101 }, undefined, now)).toThrow(RangeError)
  expect(() => database.saveScore({ ...fields, bySubject: { a: NaN } }, undefined, now)).toThrow(RangeError)
  expect(() => database.saveScore({ ...fields, date: '2026-11-26', total: 75 }, undefined, now)).toThrow(RangeError)
})

it('advances and restores a review schedule with the saved task tick', async () => {
  const exam = { id: 'main' as const, name: 'Exam', date: '2026-12-01', passingMark: 75, hoursPerDay: 1 }
  const subject = { id: 'a', name: 'A', weight: 100, color: '#4B3FD6', order: 0 }
  await database.saveSetup(exam, [subject], now)
  await database.addTopic(subject.id, '  Drug interactions  ')
  const [topic] = await database.topics.toArray()
  expect(topic).toMatchObject({ name: 'Drug interactions', weak: false })
  await database.setTopicWeak(topic.id, true)
  const [previous] = await database.getTodayPlan(now)
  expect(previous.kind).toBe('focus')

  const [review] = await database.getTodayPlan(now, true)
  expect(review).toMatchObject({ kind: 'review', topicId: topic.id })
  expect(await database.setTaskDone(review, 123)).toBe(true)
  expect(await database.topics.get(topic.id)).toMatchObject({ lastReviewedOn: '2026-11-25', reviewStep: 0, weak: true })
  const [saved] = await database.getTodayPlan(now)
  expect(await database.setTaskDone(saved, undefined)).toBe(true)
  expect(await database.topics.get(topic.id)).toMatchObject({ lastReviewedOn: undefined, reviewStep: 0, weak: true })

  await database.topics.update(topic.id, { lastReviewedOn: '2026-11-11', reviewStep: 3 })
  expect(await database.setTaskDone(review, 456)).toBe(true)
  expect(await database.topics.get(topic.id)).toMatchObject({ lastReviewedOn: '2026-11-25', reviewStep: 3, weak: false })
  const [mastered] = await database.getTodayPlan(now)
  expect(await database.setTaskDone(mastered, undefined)).toBe(true)
  expect(await database.topics.get(topic.id)).toMatchObject({ lastReviewedOn: '2026-11-11', reviewStep: 3, weak: true })

  await database.saveSetup(exam, [], now)
  expect(await database.topics.count()).toBe(0)
})

it('rejects past or invalid exam dates and out-of-range settings without replacing saved setup', async () => {
  const exam = { id: 'main' as const, name: 'Exam', date: '2026-11-25', passingMark: 75, hoursPerDay: 1 }
  await database.saveSetup(exam, [], now)
  expect(() => database.saveSetup({ ...exam, date: '2026-11-24' }, [], now)).toThrow('today or a later')
  expect(() => database.saveSetup({ ...exam, date: '2026-11-31' }, [], now)).toThrow(RangeError)
  expect(() => database.saveSetup({ ...exam, passingMark: 101 }, [], now)).toThrow(RangeError)
  expect(() => database.saveSetup({ ...exam, hoursPerDay: 1.25 }, [], now)).toThrow(RangeError)
  expect(await database.exams.get('main')).toEqual(exam)
  await database.saveSetup({ ...exam, date: '2026-11-26' }, [], now)
  expect((await database.exams.get('main'))?.date).toBe('2026-11-26')
})

it('blocks applying a preset when scores exist and resets the exam data without clearing reminder preferences', async () => {
  const exam = { id: 'main' as const, name: 'Exam', date: '2026-12-01', passingMark: 75, hoursPerDay: 1 }
  const subject = { id: 'a', name: 'A', weight: 100, color: '#4B3FD6', order: 0 }
  await database.saveSetup(exam, [subject], now)
  await database.addTopic(subject.id, 'Topic')
  await database.saveScore({ source: 'Mock', date: '2026-11-25', bySubject: {}, total: 80 }, undefined, now)
  await database.settings.put({ id: 'reminders', enabled: false, time: '09:00' })
  await expect(database.saveSetup({ ...exam, presetId: 'prc-nursing' }, [subject], now)).rejects.toThrow('Start a new exam')
  expect(await database.exams.get('main')).toEqual(exam)
  await database.resetExam()
  for (const table of [database.exams, database.subjects, database.topics, database.scores, database.tasks, database.plannedDays]) {
    expect(await table.count()).toBe(0)
  }
  expect(await database.settings.get('reminders')).toMatchObject({ enabled: false, time: '09:00' })
})
