import { format } from 'date-fns'
import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { dateKey, parseDateKey } from '../data/dates'
import { db } from '../data/db'
import { daysToGo, isReviewDue, overallScore, rankSubjects, readiness } from '../data/plan'
import type { Exam, Score, Subject, Topic } from '../data/types'

type ProgressData = { scores: Score[]; topics: Topic[] }
type Point = { id: string; date: string; source: string; value: number }

const trendPercent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 })

function percentage(value: number) {
  return Math.round(value) + '%'
}

export function Progress({ exam, subjects }: { exam: Exam; subjects: Subject[] }) {
  const [data, setData] = useState<ProgressData>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const subscription = liveQuery(() => db.transaction('r', db.scores, db.topics, async () => ({
      scores: await db.scores.orderBy('[date+createdAt]').toArray(),
      topics: await db.topics.toArray(),
    }))).subscribe({ next: setData, error: () => setFailed(true) })
    return () => subscription.unsubscribe()
  }, [])

  const points = (data?.scores ?? []).flatMap((score): Point[] => {
    const value = overallScore(score, subjects)
    return value === undefined ? [] : [{ id: score.id, date: score.date, source: score.source, value }]
  })
  const passingMark = exam.passingMark
  const summary = readiness(data?.scores ?? [], subjects, passingMark)
  const ranked = rankSubjects(subjects, data?.scores ?? [], passingMark)
  const biggestGap = Math.max(0, ...ranked.map(({ gap }) => gap ?? 0))
  const today = dateKey(new Date())
  const reviewSubjects = new Set(data?.topics.filter((topic) => isReviewDue(topic, today)).map(({ subjectId }) => subjectId))

  return (
    <div className="progress-screen">
      <h1 id="screen-title">Progress</h1>
      {failed ? <p role="alert" className="setup-error">Could not load your progress. Reopen this tab to try again.</p>
        : !data ? <p role="status">Loading your progress…</p> : (
          <>
            <section className="readiness-card" aria-labelledby="readiness-title">
              <div className="readiness-heading">
                <div>
                  <h2 id="readiness-title" className="score-caption">Readiness</h2>
                  <p className="readiness-label">{summary.label}</p>
                </div>
                <div className="readiness-score">
                  <strong><span className="sr-only">Latest overall score </span>{summary.latest === undefined ? '–' : percentage(summary.latest)}</strong>
                  <p>of {passingMark}% to pass</p>
                </div>
              </div>

              {points.length ? <ScoreTrend points={points} passingMark={passingMark} /> : (
                <p className="progress-empty">Log a mock exam score to start your trend.</p>
              )}
              <p className="trend-note">Based on the scores you entered. It's a trend, not a promise.</p>
              <p className="trend-note">Different mock exams have different difficulty.</p>
            </section>

            <section className="study-priorities" aria-labelledby="priority-title">
              <h2 id="priority-title">Where to spend your time</h2>
              {ranked.length ? (
                <ol className="priority-list">
                  {ranked.map(({ subject, gap, average }, index) => {
                    const reasons: string[] = []
                    if (gap === undefined) reasons.push('No scores yet')
                    else if (gap > 0 && gap === biggestGap) reasons.push('Biggest gap to ' + passingMark + '%')
                    else if (gap <= 0) reasons.push('At or above passing')
                    else if (gap <= 2) reasons.push('Nearly there')
                    else if (gap <= 5) reasons.push('Close')
                    else reasons.push(Math.round(gap) + ' points below passing')
                    if (reviewSubjects.has(subject.id)) reasons.push('Review due today')

                    return (
                      <li key={subject.id}>
                        <span className="priority-rank" aria-hidden="true">{index + 1}</span>
                        <div className="priority-content">
                          <div className="priority-heading">
                            <h3>{subject.name}</h3>
                            <strong className={gap === undefined ? '' : gap > 5 ? 'priority-low' : gap > 2 ? 'priority-close' : 'priority-near'}>
                              {average === undefined ? '–' : percentage(average)}
                            </strong>
                          </div>
                          <div className="priority-track" role="img"
                            aria-label={(average === undefined ? 'No subject average' : 'Subject average ' + percentage(average)) + ', passing mark ' + passingMark + '%'}>
                            <span className="priority-fill" style={{ width: (average ?? 0) + '%', background: subject.color }} />
                            <span className="passing-marker" style={{ left: 'clamp(1px, ' + passingMark + '%, calc(100% - 1px))' }} />
                          </div>
                          <p>Weight {subject.weight}% · {reasons.join(' · ')}</p>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : <p className="progress-empty">Add subjects to see where to spend your time.</p>}
            </section>
          </>
        )}
    </div>
  )
}

function ScoreTrend({ points, passingMark }: { points: Point[]; passingMark: number }) {
  const first = points[0].date
  const last = points.at(-1)!.date
  const span = daysToGo(last, first)
  const y = (value: number) => 126 - value
  const plotted = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 180 : 24 + 312 * (span ? daysToGo(point.date, first) / span : index / (points.length - 1)),
    y: y(point.value),
  }))
  const dateLabel = (date: string) => format(parseDateKey(date), 'MMM d, yyyy')
  const alternative = plotted.map((point) => dateLabel(point.date) + ', ' + point.source
    + ', ' + trendPercent.format(point.value / 100)).join('; ')

  return (
    <div className="score-trend">
      <svg viewBox="0 0 360 143" role="img" aria-label={'Overall score trend. Passing mark ' + passingMark + '%. ' + alternative}>
        <line className="trend-passing" x1="6" x2="354" y1={y(passingMark)} y2={y(passingMark)} />
        <text className="trend-pass-label" x="6" y={y(passingMark) - 7}>Pass {passingMark}%</text>
        <polyline className="trend-line" points={plotted.map(({ x, y }) => x + ',' + y).join(' ')} />
        {plotted.map((point, index) => (
          <circle key={point.id} cx={point.x} cy={point.y} r={index === plotted.length - 1 ? 6 : 4}
            className={index === plotted.length - 1 ? 'trend-point trend-point--latest' : 'trend-point'} />
        ))}
      </svg>
      <div className="trend-dates" aria-hidden="true">
        <span>{dateLabel(first)}</span>
        {last !== first && <span>{dateLabel(last)}</span>}
      </div>
      <details className="trend-values">
        <summary>Score values</summary>
        <ul>
          {points.map((point) => (
            <li key={point.id}>
              <span><time dateTime={point.date}>{dateLabel(point.date)}</time> · {point.source}</span>
              <strong>{trendPercent.format(point.value / 100)}</strong>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
