import { describe, expect, it } from 'vitest'
import {
  buildDailyPlan, completeReview, daysToGo, isReviewDue, markTopicWeak,
  overallScore, rankSubjects, readiness, reviewDueOn, studyMinutes, subjectAverage, trackingStatus,
} from './plan'
import type { Exam, Score, Subject, Topic } from './types'

const today = '2026-11-25'
const exam: Exam = { id: 'main', name: 'Practice exam', date: today, passingMark: 75, hoursPerDay: 2 }
const subjects: Subject[] = [
  { id: 'fundamentals', name: 'Fundamentals', weight: 20, order: 0, color: '#4B3FD6' },
  { id: 'pharmacology', name: 'Pharmacology', weight: 20, order: 1, color: '#1FA6A0' },
  { id: 'medical-surgical', name: 'Medical-Surgical', weight: 30, order: 2, color: '#E0559B' },
  { id: 'community-health', name: 'Community Health', weight: 15, order: 3, color: '#E89A00' },
  { id: 'mental-health', name: 'Mental Health', weight: 15, order: 4, color: '#7A7FA8' },
]
const mock: Score = {
  id: 'mock', source: 'Practice', date: today, createdAt: 1,
  bySubject: { fundamentals: 74, pharmacology: 68, 'medical-surgical': 62, 'community-health': 71, 'mental-health': 66 },
}

describe('exam and scores', () => {
  it('counts local calendar days, including exam day and a passed exam', () => {
    expect(daysToGo(today, today)).toBe(0)
    expect(daysToGo('2026-11-24', today)).toBe(-1)
    expect(daysToGo('2026-12-01', today)).toBe(6)
  })

  it('matches the design example and ranks by weighted gap', () => {
    expect(overallScore(mock, subjects)).toBeCloseTo(67.55)
    expect(Math.round(overallScore(mock, subjects)!)).toBe(68)
    expect(rankSubjects(subjects, [mock], 75).map(({ subject, priority }) => [subject.name, priority])).toEqual([
      ['Medical-Surgical', 390], ['Pharmacology', 140], ['Mental Health', 135],
      ['Community Health', 60], ['Fundamentals', 20],
    ])
  })

  it('uses the three most recent scores that include the subject and keeps zero scores', () => {
    const entries = [
      { ...mock, date: '2026-11-24', bySubject: { fundamentals: 0 } },
      { ...mock, date: '2026-11-23', bySubject: { fundamentals: 90 } },
      { ...mock, date: '2026-11-22', bySubject: { fundamentals: 100 } },
      mock,
      { ...mock, date: '2026-11-24', createdAt: 2, bySubject: {}, total: 85 },
    ]
    expect(subjectAverage('fundamentals', entries)).toBeCloseTo((74 + 0 + 90) / 3)
    expect(subjectAverage('pharmacology', entries)).toBe(68)
    expect(subjectAverage('unknown', entries)).toBeUndefined()
    expect(subjectAverage('fundamentals', [])).toBeUndefined()
  })

  it('normalizes partial scores and unbalanced weights and accepts total-only scores', () => {
    expect(overallScore({ ...mock, bySubject: { fundamentals: 50, 'medical-surgical': 100 } }, subjects)).toBe(80)
    expect(overallScore(mock, subjects.slice(0, 2))).toBe(71)
    expect(overallScore({ ...mock, bySubject: {}, total: 0 }, subjects)).toBe(0)
    expect(overallScore({ ...mock, bySubject: { removed: 100 } }, subjects)).toBeUndefined()
  })

  it('classifies readiness using the recent overall average and needs two scores', () => {
    const total = (value: number, date = today): Score => ({ ...mock, date, total: value, bySubject: {} })
    expect(readiness([], subjects, 75)).toMatchObject({ label: 'Not enough scores yet' })
    expect(readiness([mock], subjects, 75)).toMatchObject({ label: 'Not enough scores yet', latest: 67.55 })
    expect(readiness([total(64), total(64)], subjects, 75).label).toBe('Not yet')
    expect(readiness([total(65), total(65)], subjects, 75).label).toBe('Getting close')
    expect(readiness([total(80), total(70)], subjects, 75).label).toBe('Likely ready')
    expect(readiness([total(75), total(75), total(75), total(0, '2026-11-01')], subjects, 75).average).toBe(75)
  })
})

describe('daily plans and reviews', () => {
  it('ranks unscored subjects by weight and builds four tasks for today only', () => {
    expect(rankSubjects(subjects, [], 75)[0].priority).toBe(300)
    const plan = buildDailyPlan(exam, subjects, [], [], today)
    expect(plan.map((task) => task.subjectId)).toEqual(['medical-surgical', 'fundamentals', 'pharmacology', 'community-health'])
    expect(plan.every((task) => task.date === today && task.kind === 'focus')).toBe(true)
    expect(buildDailyPlan(exam, [], [], [], today)).toEqual([])
  })

  it('allocates the budget in whole 15-minute blocks with a 15-minute minimum', () => {
    const plan = buildDailyPlan(exam, subjects, [mock], [], today)
    expect(plan.map((task) => task.minutes)).toEqual([60, 30, 15, 15])
    expect(buildDailyPlan({ ...exam, hoursPerDay: 1 }, subjects, [mock], [], today).map((task) => task.minutes))
      .toEqual([15, 15, 15, 15])
  })

  it('gives passing subjects short recaps when there is room and splits all-passing time evenly', () => {
    const mixed = { ...mock, bySubject: { fundamentals: 74, pharmacology: 75 } }
    expect(buildDailyPlan(exam, subjects.slice(0, 2), [mixed], [], today).map(({ kind, minutes }) => [kind, minutes]))
      .toEqual([['focus', 105], ['recap', 15]])
    const passing = { ...mock, bySubject: Object.fromEntries(subjects.map(({ id }) => [id, 75])) }
    const recaps = buildDailyPlan({ ...exam, hoursPerDay: 2.5 }, subjects, [passing], [], today)
    expect(recaps.map(({ kind, minutes }) => [kind, minutes]))
      .toEqual([['recap', 45], ['recap', 45], ['recap', 30], ['recap', 30]])
  })

  it('starts a weak topic immediately and follows all four intervals before mastery', () => {
    let topic: Topic = { id: 'topic', subjectId: 'medical-surgical', name: 'Review', weak: true, reviewStep: 0 }
    expect(buildDailyPlan(exam, subjects, [mock], [topic], today)[0]).toMatchObject({ kind: 'review', topicId: 'topic' })
    topic = completeReview(topic, today)
    expect(isReviewDue(topic, today)).toBe(false)
    for (const due of ['2026-11-26', '2026-11-29', '2026-12-06', '2026-12-20']) {
      expect(reviewDueOn(topic)).toBe(due)
      expect(isReviewDue(topic, due)).toBe(true)
      topic = completeReview(topic, due)
    }
    expect(topic).toMatchObject({ weak: false, reviewStep: 3 })
    expect(isReviewDue(topic, '2027-01-01')).toBe(false)
    expect(isReviewDue(markTopicWeak(topic), today)).toBe(true)
  })

  it('includes today and the previous six calendar days in tracking', () => {
    const [task] = buildDailyPlan(exam, subjects, [mock], [], today)
    const completed = { ...task, minutes: 90, doneAt: 0, date: '2026-11-19' }
    const pending = { ...task, minutes: 10 }
    const older = { ...task, minutes: 30, date: '2026-11-18' }
    const future = { ...task, minutes: 30, date: '2026-11-26' }
    expect(studyMinutes([completed, pending, older])).toEqual({ planned: 130, completed: 90, fraction: 90 / 130 })
    expect(trackingStatus([completed, pending, older, future], today)).toBe('On track')
    expect(trackingStatus([pending], today)).toBe('Behind')
    expect(trackingStatus([older, future], today)).toBe('Just started')
  })
})

it('ignores future scores and uses the full budget when only recap tasks are eligible', () => {
  const active = subjects.slice(0, 2).map((subject, index) => ({ ...subject, weight: index ? 0 : 100 }))
  const passing = { ...mock, bySubject: { fundamentals: 80, pharmacology: 60 } }
  const future = { ...passing, date: '2026-11-26' }
  expect(buildDailyPlan(exam, active, [future], [], today)).toMatchObject([{ kind: 'focus', minutes: 120 }])
  expect(buildDailyPlan(exam, active, [passing], [], today)).toMatchObject([{ kind: 'recap', minutes: 120 }])
})
