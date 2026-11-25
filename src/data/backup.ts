import { parseDateKey } from './dates'
import type { PasadoDatabase } from './db'
import { defaultReminders, isReminderTime } from './reminders'
import type { Exam, ReminderSettings, Score, Subject, Task, Topic } from './types'

type Backup = {
  app: 'Pasado'
  version: 1
  exam: Exam | null
  subjects: Subject[]
  topics: Topic[]
  scores: Score[]
  tasks: Task[]
  plannedDays: { date: string }[]
  reminders: ReminderSettings
}

function invalid(): never {
  throw new Error('Choose a valid JSON backup exported by Pasado.')
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function text(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) invalid()
  return value
}

function number(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid()
  return value
}

function integer(value: unknown, min: number, max: number) {
  const result = number(value, min, max)
  if (!Number.isSafeInteger(result)) invalid()
  return result
}

function bool(value: unknown) {
  if (typeof value !== 'boolean') invalid()
  return value
}

function date(value: unknown) {
  const result = text(value)
  parseDateKey(result)
  return result
}

function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value)
}

function rows<T>(value: unknown, read: (row: Record<string, unknown>) => T, key: (row: T) => string): T[] {
  if (!Array.isArray(value)) invalid()
  const result = value.map((item: unknown) => read(object(item)))
  if (new Set(result.map(key)).size !== result.length) invalid()
  return result
}

function schedule(row: Record<string, unknown>): Pick<Topic, 'weak' | 'lastReviewedOn' | 'reviewStep'> {
  return {
    weak: bool(row.weak),
    lastReviewedOn: optional(row.lastReviewedOn, date),
    reviewStep: integer(row.reviewStep, 0, 3) as Topic['reviewStep'],
  }
}

function timestamp(value: unknown) {
  return integer(value, 0, 8_640_000_000_000_000)
}

export function parseBackup(input: string): Backup {
  try {
    const file = object(JSON.parse(input))
    if (file.app !== 'Pasado' || file.version !== 1) invalid()

    const examRow = file.exam === null ? null : object(file.exam)
    let exam: Exam | null = null
    if (examRow) {
      if (examRow.id !== 'main') invalid()
      exam = {
        id: 'main', name: text(examRow.name), date: date(examRow.date),
        passingMark: number(examRow.passingMark, 0, 100),
        hoursPerDay: integer(number(examRow.hoursPerDay, 1, 12) * 2, 2, 24) / 2,
      }
    }

    const subjects = rows(file.subjects, (row): Subject => {
      const color = text(row.color)
      if (!/^#[0-9a-f]{6}$/i.test(color)) invalid()
      return { id: text(row.id), name: text(row.name), color,
        weight: number(row.weight, 0, 100), order: integer(row.order, 0, Number.MAX_SAFE_INTEGER) }
    }, (row) => row.id)
    const subjectIds = new Set(subjects.map(({ id }) => id))

    const topics = rows(file.topics, (row): Topic => {
      const subjectId = text(row.subjectId)
      if (!subjectIds.has(subjectId)) invalid()
      return { id: text(row.id), subjectId, name: text(row.name), ...schedule(row) }
    }, (row) => row.id)

    const scores = rows(file.scores, (row): Score => {
      const bySubject = Object.fromEntries(Object.entries(object(row.bySubject))
        .map(([id, value]) => [text(id), number(value, 0, 100)]))
      const total = optional(row.total, (value) => number(value, 0, 100))
      if (!Object.keys(bySubject).length && total === undefined) invalid()
      return { id: text(row.id), source: text(row.source), date: date(row.date),
        createdAt: timestamp(row.createdAt), total, bySubject }
    }, (row) => row.id)

    const tasks = rows(file.tasks, (row): Task => {
      const { kind } = row
      if (kind !== 'focus' && kind !== 'review' && kind !== 'recap') invalid()
      const minutes = integer(row.minutes, 15, 720)
      if (minutes % 15) invalid()
      return {
        id: text(row.id), date: date(row.date), subjectId: text(row.subjectId), kind, minutes,
        topicId: optional(row.topicId, text), doneAt: optional(row.doneAt, timestamp),
        reviewBefore: optional(row.reviewBefore, (value) => schedule(object(value))),
      }
    }, (row) => row.id)

    const plannedDays = rows(file.plannedDays, (row) => ({ date: date(row.date) }), (row) => row.date)
    const reminderRow = object(file.reminders)
    const time = text(reminderRow.time)
    if (reminderRow.id !== 'reminders' || !isReminderTime(time)) invalid()
    if (!exam && (subjects.length || topics.length || scores.length || tasks.length || plannedDays.length)) invalid()
    const reminders: ReminderSettings = {
      id: 'reminders', enabled: bool(reminderRow.enabled), time, lastSentOn: optional(reminderRow.lastSentOn, date),
    }
    return { app: 'Pasado', version: 1, exam, subjects, topics, scores, tasks, plannedDays, reminders }
  } catch {
    return invalid()
  }
}

export async function exportBackup(database: PasadoDatabase): Promise<string> {
  const { exams, subjects, topics, scores, tasks, plannedDays, settings } = database
  const backup = await database.transaction('r', [exams, subjects, topics, scores, tasks, plannedDays, settings], async (): Promise<Backup> => ({
    app: 'Pasado', version: 1,
    exam: await exams.get('main') ?? null,
    subjects: await subjects.orderBy('order').toArray(),
    topics: await topics.toArray(),
    scores: await scores.toArray(),
    tasks: await tasks.toArray(),
    plannedDays: await plannedDays.toArray(),
    reminders: await settings.get('reminders') ?? defaultReminders,
  }))
  return JSON.stringify(backup, null, 2)
}

export async function restoreBackup(database: PasadoDatabase, input: string) {
  const backup = parseBackup(input)
  const { exams, subjects, topics, scores, tasks, plannedDays, settings } = database
  const tables = [exams, subjects, topics, scores, tasks, plannedDays, settings]
  await database.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.clear()))
    if (backup.exam) await exams.add(backup.exam)
    await Promise.all([
      subjects.bulkAdd(backup.subjects),
      topics.bulkAdd(backup.topics),
      scores.bulkAdd(backup.scores),
      tasks.bulkAdd(backup.tasks),
      plannedDays.bulkAdd(backup.plannedDays),
      settings.add(backup.reminders),
    ])
  })
}
