import Dexie, { type Table } from 'dexie'
import { dateKey, parseDateKey } from './dates'
import { buildDailyPlan } from './plan'
import type { Exam, Score, Subject, Task, Topic } from './types'

export type ScoreFields = Pick<Score, 'source' | 'date' | 'total' | 'bySubject'>

export class PasadoDatabase extends Dexie {
  exams!: Table<Exam, Exam['id']>
  subjects!: Table<Subject, string>
  topics!: Table<Topic, string>
  scores!: Table<Score, string>
  tasks!: Table<Task, string>
  plannedDays!: Table<{ date: string }, string>

  constructor(name = 'pasado') {
    super(name)
    this.version(1).stores({
      exams: 'id',
      subjects: 'id, order',
      topics: 'id, subjectId',
      scores: 'id, [date+createdAt]',
      tasks: 'id, date',
      plannedDays: 'date',
    })
  }

  saveSetup(exam: Exam, subjects: readonly Subject[], now = new Date()): Promise<void> {
    const tables = [this.exams, this.subjects, this.topics, this.scores, this.tasks, this.plannedDays]
    return this.transaction('rw', tables, async () => {
      const previousExam = await this.exams.get('main')
      const previousSubjects = await this.subjects.toArray()
      const byId = new Map(previousSubjects.map((subject) => [subject.id, subject]))
      const changed = previousExam?.hoursPerDay !== exam.hoursPerDay
        || previousSubjects.length !== subjects.length
        || subjects.some((subject) => {
          const previous = byId.get(subject.id)
          return previous?.weight !== subject.weight || previous.order !== subject.order
            || previous.name !== subject.name || previous.color !== subject.color
        })

      await this.exams.put(exam)
      for (const subject of subjects) byId.delete(subject.id)
      await this.subjects.bulkDelete([...byId.keys()])
      await this.subjects.bulkPut(subjects)

      if (changed) {
        const today = dateKey(now)
        await this.tasks.where('date').equals(today).delete()
        await this.plannedDays.delete(today)
      }
      if (!previousExam) await this.getTodayPlan(now)
    })
  }

  getTodayPlan(now = new Date(), rebuild = false): Promise<Task[]> {
    const today = dateKey(now)
    const tables = [this.exams, this.subjects, this.topics, this.scores, this.tasks, this.plannedDays]
    return this.transaction('rw', tables, async () => {
      const todayTasks = this.tasks.where('date').equals(today)
      const saved = await todayTasks.toArray()
      if (!rebuild && (saved.length || await this.plannedDays.get(today))) return saved

      const exam = await this.exams.get('main')
      if (!exam) return []
      const [subjects, scores, topics] = await Promise.all([
        this.subjects.toArray(),
        this.scores.toArray(),
        this.topics.toArray(),
      ])
      const plan = buildDailyPlan(exam, subjects, scores, topics, today)
      if (rebuild) await todayTasks.delete()
      await this.tasks.bulkAdd(plan)
      if (subjects.length) await this.plannedDays.put({ date: today })
      return plan
    })
  }

  setTaskDone(task: Task, doneAt: number | undefined): Promise<boolean> {
    return this.transaction('rw', this.tasks, async () => {
      const current = await this.tasks.get(task.id)
      if (!current || current.doneAt !== task.doneAt || current.minutes !== task.minutes
        || current.kind !== task.kind || current.topicId !== task.topicId) return false
      if (doneAt === undefined) delete current.doneAt
      else current.doneAt = doneAt
      await this.tasks.put(current)
      return true
    })
  }

  saveScore(fields: ScoreFields, id?: string, now = new Date()): Promise<void> {
    const source = fields.source.trim()
    if (!source) throw new RangeError('Enter a score source.')
    parseDateKey(fields.date)
    if (fields.date > dateKey(now)) throw new RangeError('Choose today or an earlier date.')
    const subjectValues = Object.values(fields.bySubject)
    const values = subjectValues.length ? subjectValues : [fields.total]
    if (values.some((value) => value === undefined || !Number.isFinite(value) || value < 0 || value > 100)) {
      throw new RangeError('Enter scores from 0 to 100%.')
    }
    const score = { source, date: fields.date, bySubject: fields.bySubject,
      ...(subjectValues.length ? {} : { total: fields.total }) }

    return this.transaction('rw', this.scores, async () => {
      if (id !== undefined) {
        const previous = await this.scores.get(id)
        if (!previous) throw new Error('This score was already removed.')
        await this.scores.put({ ...score, id, createdAt: previous.createdAt })
      } else {
        await this.scores.add({ ...score, id: crypto.randomUUID(), createdAt: now.getTime() })
      }
    })
  }
}

export const db = new PasadoDatabase()
