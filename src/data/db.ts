import Dexie, { type Table } from 'dexie'
import { dateKey, parseDateKey } from './dates'
import { buildDailyPlan, completeReview, markTopicWeak } from './plan'
import type { Exam, ReminderSettings, Score, Subject, Task, Topic } from './types'

export type ScoreFields = Pick<Score, 'source' | 'date' | 'total' | 'bySubject'>

export class PasadoDatabase extends Dexie {
  exams!: Table<Exam, Exam['id']>
  subjects!: Table<Subject, string>
  topics!: Table<Topic, string>
  scores!: Table<Score, string>
  tasks!: Table<Task, string>
  plannedDays!: Table<{ date: string }, string>
  settings!: Table<ReminderSettings, ReminderSettings['id']>

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
    this.version(2).stores({ settings: 'id' })
    // Existing exam records stay valid without either optional field.
    this.version(3).stores({ exams: 'id, presetId' })
  }

  saveSetup(exam: Exam, subjects: readonly Subject[], now = new Date()): Promise<void> {
    parseDateKey(exam.date)
    if (exam.date < dateKey(now)) throw new RangeError('Choose today or a later exam date.')
    const name = exam.name.trim()
    if (!name) throw new RangeError('Enter an exam name.')
    if (!Number.isFinite(exam.passingMark) || exam.passingMark < 0 || exam.passingMark > 100) {
      throw new RangeError('Enter a passing mark from 0 to 100%.')
    }
    if (exam.minPerSubject !== undefined && (!Number.isFinite(exam.minPerSubject)
      || exam.minPerSubject < 0 || exam.minPerSubject > 100)) {
      throw new RangeError('Enter a minimum per subject from 0 to 100%.')
    }
    if (!Number.isInteger(exam.hoursPerDay * 2) || exam.hoursPerDay < 1 || exam.hoursPerDay > 12) {
      throw new RangeError('Choose 1 to 12 study hours in half-hour steps.')
    }
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

      await this.exams.put({ ...exam, name })
      for (const subject of subjects) byId.delete(subject.id)
      if (byId.size) await this.topics.where('subjectId').anyOf([...byId.keys()]).delete()
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
    return this.transaction('rw', this.tasks, this.topics, async () => {
      const current = await this.tasks.get(task.id)
      if (!current || current.doneAt !== task.doneAt || current.minutes !== task.minutes
        || current.kind !== task.kind || current.topicId !== task.topicId) return false
      if (current.kind === 'review' && current.topicId) {
        const topic = await this.topics.get(current.topicId)
        if (topic && doneAt !== undefined) {
          const reviewed = completeReview(topic, current.date)
          if (reviewed !== topic) {
            const { weak, lastReviewedOn, reviewStep } = topic
            current.reviewBefore = { weak, lastReviewedOn, reviewStep }
            await this.topics.put(reviewed)
          }
        } else if (topic && current.reviewBefore) {
          const reviewed = completeReview({ ...topic, ...current.reviewBefore }, current.date)
          if (topic.weak === reviewed.weak && topic.lastReviewedOn === reviewed.lastReviewedOn
            && topic.reviewStep === reviewed.reviewStep) {
            await this.topics.put({ ...topic, ...current.reviewBefore })
          }
        }
      }
      if (doneAt === undefined) {
        delete current.reviewBefore
        delete current.doneAt
      } else current.doneAt = doneAt
      await this.tasks.put(current)
      return true
    })
  }

  addTopic(subjectId: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new RangeError('Enter a topic name.')
    return this.transaction('rw', this.subjects, this.topics, async () => {
      if (!await this.subjects.get(subjectId)) throw new Error('Save the subject first.')
      await this.topics.add({ id: crypto.randomUUID(), subjectId, name: trimmed, weak: false, reviewStep: 0 })
    })
  }

  setTopicWeak(id: string, weak: boolean): Promise<void> {
    return this.transaction('rw', this.topics, async () => {
      const topic = await this.topics.get(id)
      if (!topic || topic.weak === weak) return
      await this.topics.put(weak ? markTopicWeak(topic) : { ...topic, weak: false, lastReviewedOn: undefined, reviewStep: 0 })
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
