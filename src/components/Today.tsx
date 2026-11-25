import { format } from 'date-fns'
import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { db } from '../data/db'
import { useLocalDay } from '../hooks/useLocalDay'
import { presetCoverageFor } from '../presets'
import { parseDateKey } from '../data/dates'
import { daysToGo, isReviewDue, rankSubjects, studyMinutes, trackingStatus } from '../data/plan'
import type { Exam, Score, Subject, Task, Topic } from '../data/types'

export function Today({ exam, subjects }: { exam: Exam; subjects: Subject[] }) {
  const day = useLocalDay()
  return <DailyView key={day} exam={exam} subjects={subjects} day={day} />
}

type DailyData = { history: Task[]; topics: Topic[]; scores: Score[] }
type Undo = { task: Task; subject: string }

function DailyView({ exam, subjects, day }: { exam: Exam; subjects: Subject[]; day: string }) {
  const [data, setData] = useState<DailyData>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<Undo>()

  useEffect(() => {
    let active = true
    const updates = liveQuery(() => db.transaction('r', db.tasks, db.topics, db.scores, async () => ({
      history: await db.tasks.where('date').belowOrEqual(day).toArray(),
      topics: await db.topics.toArray(),
      scores: await db.scores.where('[date+createdAt]').belowOrEqual([day, Number.MAX_SAFE_INTEGER]).toArray(),
    })))
    let subscription: ReturnType<typeof updates.subscribe> | undefined
    db.getTodayPlan(parseDateKey(day)).catch(() => {
      if (active) setError('Could not load your study plan. Try rebuilding it.')
    }).then(() => {
      if (!active) return
      subscription = updates.subscribe({
        next: setData,
        error: () => setError('Could not read your study plan.'),
      })
    })
    return () => {
      active = false
      subscription?.unsubscribe()
    }
  }, [day])

  const history = data?.history ?? []
  const tasks = history.filter((task) => task.date === day)
  const { completed, planned } = studyMinutes(tasks)
  const overall = studyMinutes(history)
  const percent = Math.round(overall.fraction * 100)
  const hasHistory = overall.completed > 0 || history.some((task) => task.date < day)
  const status = hasHistory ? trackingStatus(history, day) : 'Just started'
  const remaining = daysToGo(exam.date, day)
  const belowMinimum = exam.minPerSubject === undefined ? [] :
    rankSubjects(subjects, data?.scores ?? [], exam.passingMark, exam.minPerSubject)
      .filter((entry) => entry.belowMinimum).map(({ subject }) => subject)
  const nextTask = tasks.find(({ doneAt }) => doneAt === undefined)
  const startsBelowMinimum = belowMinimum.some(({ id }) => id === nextTask?.subjectId)
  const canPrioritizeToday = !!nextTask || tasks.length === 0
  const [rebuildNotice, setRebuildNotice] = useState('')

  async function write(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch {
      setError('Could not update your plan. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function toggle(task: Task, subject: string) {
    void write(async () => {
      const doneAt = task.doneAt === undefined ? Date.now() : undefined
      if (await db.setTaskDone(task, doneAt)) {
        setUndo(doneAt === undefined ? undefined : { task: { ...task, doneAt }, subject })
      }
    })
  }

  function undoCompletion() {
    if (!undo) return
    void write(async () => {
      await db.setTaskDone(undo.task, undefined)
      setUndo(undefined)
    })
  }

  function rebuild() {
    void write(async () => {
      const rebuilt = await db.getTodayPlan(parseDateKey(day), true)
      const remaining = rebuilt.filter(({ doneAt }) => doneAt === undefined).length
      setRebuildNotice('Remaining tasks updated · ' + remaining + ' left. Completed work kept.')
      setUndo(undefined)
    })
  }

  return (
    <div className="today">
      <header className="today-heading">
        <h1 id="screen-title">Today</h1>
        <time dateTime={day}>{format(parseDateKey(day), 'EEE, MMM d')}</time>
      </header>

      <section className="countdown" aria-label="Exam countdown">
        <h2>{exam.name}</h2>
        <div className="countdown-row">
          <div>
            <p className="countdown-value">
              {remaining < 0 ? 'Exam day passed' : remaining === 0 ? 'Exam day' : remaining + (remaining === 1 ? ' day' : ' days')}
            </p>
            <p className="countdown-date">
              {remaining > 0 && 'to go · '}<time dateTime={exam.date}>{format(parseDateKey(exam.date), 'MMM d, yyyy')}</time>
            </p>
          </div>
          {data && (
            <p className={'track-status' + (status === 'On track' ? ' track-status--good' : status === 'Behind' ? ' track-status--behind' : '')}>
              <span aria-hidden="true">{status === 'On track' ? '✓' : status === 'Behind' ? '!' : '○'}</span> {status}
            </p>
          )}
        </div>
        {remaining < 0 && <a className="countdown-link" href="#subjects">Set a new date</a>}
        {data && (
          <>
            <progress className="countdown-progress" max={100} value={percent} aria-label="Planned study time completed" />
            <p className="countdown-detail">{percent}% of your planned study hours done so far</p>
          </>
        )}
      </section>

      <section className="daily-plan" aria-labelledby="daily-plan-title">
        <div className="daily-plan-heading">
          <h2 id="daily-plan-title">Today's plan</h2>
          {data && <p aria-live="polite">{duration(planned)} planned · {duration(completed)} done</p>}
        </div>
        {!!belowMinimum.length && (
          <p className="minimum-warning">
            <span aria-hidden="true">⚠</span> Below the minimum in {belowMinimum.map(({ name }) => name).join(', ')}.{' '}
            {startsBelowMinimum ? "Today's plan starts there." : canPrioritizeToday
              ? "Rebuild today's plan to prioritize those subjects." : "Today's plan is complete."}
            {!startsBelowMinimum && canPrioritizeToday && <button type="button" className="text-button" onClick={rebuild} disabled={busy}>Rebuild plan</button>}
          </p>
        )}
        <p className="rebuild-notice" role="status">{rebuildNotice}</p>
        {error && <p role="alert" className="setup-error">{error}</p>}
        {data ? tasks.length ? (
          <ul className="daily-tasks">
            {tasks.map((task, index) => {
              const subject = subjects.find(({ id }) => id === task.subjectId)
              const name = subject?.name ?? 'Removed subject'
              const coverage = presetCoverageFor(exam.presetId, name)
              const topic = data.topics.find(({ id }) => id === task.topicId)
              const detail = [task.minutes + ' min', topic?.name ?? (task.kind === 'recap' ? 'Quick recap' : '')].filter(Boolean).join(' · ')
              const reviewDue = task.kind === 'review' && task.doneAt === undefined && topic && isReviewDue(topic, day)
              const detailId = 'today-task-detail-' + index
              const reviewId = 'today-task-review-' + index
              return (
                <li className={'daily-task' + (coverage ? ' daily-task--has-coverage' : '')
                  + (task.doneAt !== undefined ? ' daily-task--done' : task.id === nextTask?.id ? ' daily-task--next' : '')} key={task.id}>
                  <button type="button" className="task-toggle" aria-label={'Complete ' + name}
                    aria-describedby={reviewDue ? detailId + ' ' + reviewId : detailId}
                    aria-pressed={task.doneAt !== undefined} disabled={busy} onClick={() => toggle(task, name)}>
                    <span className="task-check" aria-hidden="true">{task.doneAt !== undefined ? '✓' : ''}</span>
                    <span className="task-copy">
                      {task.id === nextTask?.id && <span className="next-task-label">Up next</span>}
                      <strong>{name}</strong>
                      <span id={detailId} className="task-detail"><span className="subject-dot" style={{ backgroundColor: subject?.color }} aria-hidden="true" />{detail}</span>
                    </span>
                    {reviewDue && <span id={reviewId} className="review-tag">Review due</span>}
                  </button>
                  {coverage && (
                    <details className="today-coverage">
                      <summary aria-label={'Coverage for ' + name}>Coverage</summary>
                      <p>{coverage}</p>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        ) : subjects.length ? (
          <p className="plan-empty">No study tasks for today.</p>
        ) : (
          <p className="plan-empty"><a href="#subjects">Add your subjects to get a plan</a></p>
        ) : !error && <p role="status">Loading your plan…</p>}
        {!!subjects.length && (data || error) && (
          <button type="button" className="rebuild-plan" disabled={busy} onClick={rebuild}>Rebuild today's plan</button>
        )}
      </section>

      <a className="log-score-link" href="#scores">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 20V10m7 10V4m7 16v-7" />
        </svg>
        <span>Took a mock exam? Log your score</span>
      </a>

      {undo && (
        <div className="today-toast">
          <p role="status">{undo.subject} marked done.</p>
          <button type="button" disabled={busy} onClick={undoCompletion}>Undo</button>
          <button type="button" aria-label="Dismiss notification" onClick={() => setUndo(undefined)}>×</button>
        </div>
      )}
    </div>
  )
}

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return remainder ? remainder + ' min' : '0 h'
  return hours + ' h' + (remainder ? ' ' + remainder + ' min' : '')
}
