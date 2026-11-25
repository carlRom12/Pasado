import { format } from 'date-fns'
import { liveQuery } from 'dexie'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { parseDateKey } from '../data/dates'
import { db } from '../data/db'
import { overallScore } from '../data/plan'
import type { Exam, Score, Subject } from '../data/types'
import { useLocalDay } from '../hooks/useLocalDay'

export function Scores({ exam, subjects }: { exam: Exam; subjects: Subject[] }) {
  const today = useLocalDay()
  const [scores, setScores] = useState<Score[]>()
  const [source, setSource] = useState('')
  const [dateOverride, setDate] = useState<string>()
  const date = dateOverride ?? today
  const [subjectInputs, setSubjectInputs] = useState<Record<string, string>>({})
  const [total, setTotal] = useState('')
  const [editing, setEditing] = useState<Score>()
  const [deleting, setDeleting] = useState<string>()
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const sourceField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const subscription = liveQuery(() => db.scores.orderBy('[date+createdAt]').reverse().toArray()).subscribe({
      next: setScores,
      error: () => setHistoryError('Could not load your recent scores.'),
    })
    return () => subscription.unsubscribe()
  }, [])

  const suggestions = [...new Map((scores ?? []).map(({ source }) => [source.toLowerCase(), source])).values()]
  const entered = Object.entries(subjectInputs).filter(([, value]) => value !== '')
  const bySubject = Object.fromEntries(entered.map(([id, value]) => [id, Number(value)]))
  const archived = Object.fromEntries(Object.entries(editing?.bySubject ?? {})
    .filter(([id]) => !subjects.some((subject) => subject.id === id)))
  const showTotal = entered.length === 0
  const useArchived = !(showTotal && total !== '')
  const subjectScores = useArchived ? { ...archived, ...bySubject } : bySubject
  const enteredTotal = showTotal && total !== '' ? Number(total) : undefined
  const preview = Object.values(subjectScores).some((value) => value < 0 || value > 100)
    || (enteredTotal !== undefined && (enteredTotal < 0 || enteredTotal > 100))
    ? undefined : overallScore({ id: '', source, date, createdAt: 0, bySubject: subjectScores, total: enteredTotal }, subjects)

  function startEditing(score?: Score) {
    setEditing(score)
    setSource(score?.source ?? '')
    setDate(score?.date)
    setSubjectInputs(Object.fromEntries(subjects.flatMap(({ id }) =>
      score && Object.hasOwn(score.bySubject, id) ? [[id, String(score.bySubject[id])]] : [])))
    setTotal(score?.total === undefined ? '' : String(score.total))
    setError('')
    setDeleting(undefined)
    sourceField.current?.focus()
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    setNotice('')
    if (!source.trim()) {
      setError('Enter where the score came from.')
      sourceField.current?.focus()
      return
    }
    if (showTotal && enteredTotal === undefined && !Object.keys(archived).length) {
      setError('Enter a subject score or an overall score.')
      return
    }
    setBusy(true)
    try {
      await db.saveScore({ source, date, bySubject: subjectScores, total: enteredTotal }, editing?.id)
      window.location.hash = 'progress'
    } catch (failure) {
      setError(failure instanceof RangeError ? failure.message : 'Could not save the score. Check your recent scores and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(score: Score) {
    if (busy) return
    setBusy(true)
    setHistoryError('')
    setNotice('')
    try {
      await db.scores.delete(score.id)
      if (editing?.id === score.id) startEditing()
      setDeleting(undefined)
      setNotice('Score deleted.')
    } catch {
      setHistoryError('Could not delete the score. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scores">
      <h1 id="screen-title">{editing ? 'Edit score' : 'Log a score'}</h1>
      <form className="score-form" onSubmit={save}>
        <fieldset disabled={busy}>
          <div className="setup-field-row">
            <label className="setup-field">
              <span>Where from</span>
              <input ref={sourceField} value={source} onChange={(event) => setSource(event.target.value)}
                list="score-sources" placeholder="Mock exam or reviewer" required />
              <datalist id="score-sources">{suggestions.map((value) => <option key={value} value={value} />)}</datalist>
            </label>
            <label className="setup-field">
              <span>Date</span>
              <input type="date" value={date} min="0001-01-01" max={today} onChange={(event) => setDate(event.target.value)} required />
            </label>
          </div>

          {!!subjects.length && (
            <section className="score-subjects" aria-labelledby="subject-score-title">
              <h2 id="subject-score-title" className="score-caption">Your score per subject</h2>
              <div className="score-card score-subject-list">
                {subjects.map((subject) => (
                  <label className="score-subject" key={subject.id}>
                    <span className="subject-dot" aria-hidden="true" style={{ backgroundColor: subject.color }} />
                    <span className="score-subject-name">
                      <strong>{subject.name}</strong>
                      <small>Weight {subject.weight}%</small>
                    </span>
                    <span className="score-number">
                      <input aria-label={subject.name + ' score (%)'} type="number" min="0" max="100" step="any" inputMode="decimal"
                        value={subjectInputs[subject.id] ?? ''}
                        onChange={(event) => setSubjectInputs({ ...subjectInputs, [subject.id]: event.target.value })}
                        placeholder="–" />
                      <span aria-hidden="true">%</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}

          <div className="score-summary">
            <div>
              <h2 className="score-caption">{showTotal ? 'Overall score' : 'Overall (weighted)'}</h2>
              <p>Passing mark is {exam.passingMark}%</p>
            </div>
            {showTotal ? (
              <label className="score-number score-total">
                <input aria-label="Overall score (%)" type="number" min="0" max="100" step="any" inputMode="decimal" placeholder="–"
                  value={total} onChange={(event) => setTotal(event.target.value)} />
                <span aria-hidden="true">%</span>
              </label>
            ) : (
              <output aria-label="Weighted overall score" aria-live="polite">{preview === undefined ? '–' : Math.round(preview) + '%'}</output>
            )}
          </div>
          {!!subjects.length && <p className="score-help">Only know your total? Leave the subjects blank and enter just the overall score.</p>}
          {!!Object.keys(archived).length && (
            <p className="score-help">This entry includes scores for removed subjects. Enter an overall score to replace them.</p>
          )}
        </fieldset>

        {error && <p role="alert" className="setup-error">{error}</p>}
        <button type="submit" className="setup-primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Save score'}
        </button>
        {editing && <button type="button" className="text-button score-cancel" disabled={busy} onClick={() => startEditing()}>Cancel edit</button>}
      </form>

      <section className="recent-scores" aria-labelledby="recent-score-title">
        <h2 id="recent-score-title">Recent scores</h2>
        {historyError && <p role="alert" className="setup-error">{historyError}</p>}
        <p role="status">{notice}</p>
        {!scores ? (
          !historyError && <p>Loading recent scores…</p>
        ) : scores.length ? (
          <ul className="score-card recent-score-list">
            {scores.map((score) => {
              const overall = overallScore(score, subjects)
              const dateLabel = format(parseDateKey(score.date), 'MMM d, yyyy')
              return (
                <li key={score.id}>
                  <div className="recent-score-entry">
                    <div className="recent-score-copy">
                      <strong>{score.source}</strong>
                      <time dateTime={score.date}>{dateLabel}</time>
                    </div>
                    <span className="recent-score-value">{overall === undefined ? '–' : Math.round(overall) + '%'}</span>
                  </div>
                  {deleting === score.id ? (
                    <div className="recent-score-actions">
                      <span>Delete this score?</span>
                      <button type="button" className="text-button" onClick={() => setDeleting(undefined)} disabled={busy}>Cancel</button>
                      <button type="button" className="text-button score-delete" onClick={() => void remove(score)} disabled={busy}>Delete score</button>
                    </div>
                  ) : (
                    <div className="recent-score-actions">
                      <button type="button" className="text-button" onClick={() => startEditing(score)} disabled={busy}
                        aria-label={'Edit score from ' + score.source + ' on ' + dateLabel}>Edit</button>
                      <button type="button" className="text-button score-delete" onClick={() => setDeleting(score.id)} disabled={busy}
                        aria-label={'Delete score from ' + score.source + ' on ' + dateLabel}>Delete</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="score-card score-empty">No scores logged yet.</p>
        )}
      </section>
    </div>
  )
}
