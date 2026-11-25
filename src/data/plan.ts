import { addDays, differenceInCalendarDays } from 'date-fns'
import { dateKey, parseDateKey } from './dates'
import type { Exam, Score, Subject, Task, Topic } from './types'

const reviewIntervals = [1, 3, 7, 14]
const blockMinutes = 15

export function daysToGo(examDate: string, today: string): number {
  return differenceInCalendarDays(parseDateKey(examDate), parseDateKey(today))
}

function newestFirst(scores: readonly Score[]): Score[] {
  return [...scores].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function subjectAverage(subjectId: string, scores: readonly Score[]): number | undefined {
  const values = newestFirst(scores)
    .map((score) => Object.hasOwn(score.bySubject, subjectId) ? score.bySubject[subjectId] : undefined)
    .filter((value) => value !== undefined)
    .slice(0, 3)
  return values.length ? mean(values) : undefined
}

export function overallScore(score: Score, subjects: readonly Subject[]): number | undefined {
  if (Object.keys(score.bySubject).length === 0) return score.total

  let weighted = 0
  let weight = 0
  for (const subject of subjects) {
    if (Object.hasOwn(score.bySubject, subject.id)) {
      weighted += subject.weight * score.bySubject[subject.id]
      weight += subject.weight
    }
  }
  return weight > 0 ? weighted / weight : undefined
}

export function rankSubjects(subjects: readonly Subject[], scores: readonly Score[], passingMark: number) {
  return subjects.map((subject) => {
    const average = subjectAverage(subject.id, scores)
    const gap = average === undefined ? undefined : passingMark - average
    return { subject, average, gap, priority: subject.weight * (gap === undefined ? 10 : Math.max(gap, 0)) }
  }).sort((a, b) => b.priority - a.priority || a.subject.order - b.subject.order)
}

export function reviewDueOn(topic: Topic): string | undefined {
  if (!topic.weak) return undefined
  if (!topic.lastReviewedOn) return undefined
  return dateKey(addDays(parseDateKey(topic.lastReviewedOn), reviewIntervals[topic.reviewStep]))
}

export function isReviewDue(topic: Topic, today: string): boolean {
  if (!topic.weak) return false
  const due = reviewDueOn(topic)
  return due === undefined || due <= today
}

export function completeReview(topic: Topic, today: string): Topic {
  if (!isReviewDue(topic, today)) return topic
  // The first review starts the schedule. Later reviews complete the current interval.
  if (!topic.lastReviewedOn) return { ...topic, lastReviewedOn: today, reviewStep: 0 }
  if (topic.reviewStep === 3) return { ...topic, lastReviewedOn: today, weak: false }
  const nextStep = [1, 2, 3] as const
  return { ...topic, lastReviewedOn: today, reviewStep: nextStep[topic.reviewStep] }
}

export function markTopicWeak(topic: Topic): Topic {
  return { ...topic, weak: true, lastReviewedOn: undefined, reviewStep: 0 }
}

function splitBlocks(total: number, priorities: readonly number[]): number[] {
  const weight = priorities.reduce((sum, value) => sum + value, 0)
  const blocks = priorities.map((priority) => Math.max(1, Math.round(total * priority / weight)))
  let remaining = total - blocks.reduce((sum, value) => sum + value, 0)
  if (remaining >= 0) {
    blocks[0] += remaining
  } else {
    for (let index = 0; index < blocks.length && remaining < 0; index += 1) {
      const reduction = Math.min(blocks[index] - 1, -remaining)
      blocks[index] -= reduction
      remaining += reduction
    }
  }
  return blocks
}

export function buildDailyPlan(
  exam: Exam,
  subjects: readonly Subject[],
  scores: readonly Score[],
  topics: readonly Topic[],
  today: string,
): Task[] {
  const budget = Math.round(exam.hoursPerDay * 60 / blockMinutes)
  const limit = Math.min(budget, 4)
  if (limit < 1) return []

  const ranked = rankSubjects(subjects, scores.filter((score) => score.date <= today), exam.passingMark)
  const focus = ranked.filter(({ priority }) => priority > 0).slice(0, limit)
  const recaps = ranked.filter(({ gap }) => gap !== undefined && gap <= 0)
  const selected = [...focus, ...recaps.slice(0, limit - focus.length)]
  if (!selected.length) return []

  const blocks = focus.length
    ? [...splitBlocks(budget - (selected.length - focus.length), focus.map(({ priority }) => priority)),
        ...selected.slice(focus.length).map(() => 1)]
    : selected.map((_, index) =>
        Math.floor(budget / selected.length) + Number(index < budget % selected.length))

  const due = topics.filter((topic) => isReviewDue(topic, today)).sort((a, b) =>
    (reviewDueOn(a) ?? '').localeCompare(reviewDueOn(b) ?? '') || a.id.localeCompare(b.id))

  return selected.map(({ subject }, index) => {
    const topic = due.find((candidate) => candidate.subjectId === subject.id)
    return {
      id: today + ':' + index + ':' + subject.id,
      date: today,
      subjectId: subject.id,
      ...(topic && { topicId: topic.id }),
      minutes: blocks[index] * blockMinutes,
      kind: topic ? 'review' : index < focus.length ? 'focus' : 'recap',
    }
  })
}

export function studyMinutes(tasks: readonly Task[]) {
  let planned = 0
  let completed = 0
  for (const task of tasks) {
    planned += task.minutes
    if (task.doneAt !== undefined) completed += task.minutes
  }
  return { planned, completed, fraction: planned ? completed / planned : 0 }
}

export function trackingStatus(tasks: readonly Task[], today: string) {
  const firstDay = dateKey(addDays(parseDateKey(today), -6))
  const { planned, fraction } = studyMinutes(tasks.filter((task) => task.date >= firstDay && task.date <= today))
  if (!planned) return 'Just started'
  return fraction >= 0.9 ? 'On track' : 'Behind'
}

export function readiness(scores: readonly Score[], subjects: readonly Subject[], passingMark: number) {
  const values = newestFirst(scores)
    .map((score) => overallScore(score, subjects))
    .filter((value) => value !== undefined)
    .slice(0, 3)
  const average = values.length ? mean(values) : undefined
  let label = 'Not enough scores yet'
  if (values.length >= 2 && average !== undefined) {
    if (average >= passingMark) label = 'Likely ready'
    else if (average >= passingMark - 10) label = 'Getting close'
    else label = 'Not yet'
  }
  return { label, latest: values[0], average }
}
