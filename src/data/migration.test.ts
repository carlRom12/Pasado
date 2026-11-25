import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { PasadoDatabase } from './db'

it('migrates a v1 app database without changing its existing exam or other data', async () => {
  const name = 'pasado-schema-migration'
  const legacy = new Dexie(name, { autoOpen: false })
  legacy.version(1).stores({
    exams: 'id',
    subjects: 'id, order',
    topics: 'id, subjectId',
    scores: 'id, [date+createdAt]',
    tasks: 'id, date',
    plannedDays: 'date',
  })
  legacy.version(2).stores({ settings: 'id' })

  const exam = { id: 'main', name: 'Existing exam', date: '2026-12-01', passingMark: 75, hoursPerDay: 3 }
  const subject = { id: 's', name: 'Existing subject', weight: 100, order: 0, color: '#4B3FD6' }
  const task = { id: 't', date: '2026-11-25', subjectId: 's', kind: 'focus', minutes: 180, doneAt: 123 }
  const settings = { id: 'reminders', enabled: false, time: '08:30' }
  const database = new PasadoDatabase(name)
  try {
    await legacy.open()
    await legacy.table('exams').add(exam)
    await legacy.table('subjects').add(subject)
    await legacy.table('tasks').add(task)
    await legacy.table('settings').add(settings)
    legacy.close()

    await database.open()
    expect(database.verno).toBe(3)
    expect(await database.exams.get('main')).toEqual(exam)
    expect(await database.subjects.toArray()).toEqual([subject])
    expect(await database.tasks.toArray()).toEqual([task])
    expect(await database.settings.get('reminders')).toEqual(settings)
  } finally {
    legacy.close()
    await database.delete()
  }
})
