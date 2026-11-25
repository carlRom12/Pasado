export type Exam = {
  id: 'main'
  name: string
  date: string
  passingMark: number
  hoursPerDay: number
}

export type Subject = {
  id: string
  name: string
  weight: number
  color: string
  order: number
}

export type Topic = {
  id: string
  subjectId: string
  name: string
  weak: boolean
  lastReviewedOn?: string
  reviewStep: 0 | 1 | 2 | 3
}

export type Score = {
  id: string
  source: string
  date: string
  total?: number
  bySubject: Record<string, number>
  createdAt: number
}

export type Task = {
  id: string
  date: string
  subjectId: string
  topicId?: string
  minutes: number
  kind: 'focus' | 'review' | 'recap'
  doneAt?: number
  reviewBefore?: Pick<Topic, 'weak' | 'lastReviewedOn' | 'reviewStep'>
}

export type ReminderSettings = {
  id: 'reminders'
  enabled: boolean
  time: string
  lastSentOn?: string
}
