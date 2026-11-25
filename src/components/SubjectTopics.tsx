import { format } from 'date-fns'
import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { db } from '../data/db'
import { dateKey, parseDateKey } from '../data/dates'
import { isReviewDue, reviewDueOn } from '../data/plan'
import type { Subject, Topic } from '../data/types'

function topicStatus(topic: Topic) {
  if (!topic.weak) return topic.lastReviewedOn && topic.reviewStep === 3 ? 'Mastered' : 'Not marked weak'
  if (isReviewDue(topic, dateKey(new Date()))) return 'Review due'
  const due = reviewDueOn(topic)
  return due ? 'Next review ' + format(parseDateKey(due), 'MMM d, yyyy') : 'Review due'
}

export function SubjectTopics({ subject }: { subject: Subject }) {
  const [open, setOpen] = useState(false)

  return (
    <details className="subject-topics" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={'Topics for ' + subject.name}>Topics</summary>
      {open && <TopicList subject={subject} />}
    </details>
  )
}

function TopicList({ subject }: { subject: Subject }) {
  const [topics, setTopics] = useState<Topic[]>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<string>()

  useEffect(() => {
    const subscription = liveQuery(() => db.topics.where('subjectId').equals(subject.id).sortBy('name')).subscribe({
      next: setTopics,
      error: () => setError('Could not load topics.'),
    })
    return () => subscription.unsubscribe()
  }, [subject.id])

  async function update(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (failure) {
      setError(failure instanceof RangeError ? failure.message : 'Could not update this topic. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function add() {
    void update(async () => {
      await db.addTopic(subject.id, name)
      setName('')
    })
  }

  return (
    <div className="topic-list">
      {topics?.length ? (
        <ul>
          {topics.map((topic) => (
            <li key={topic.id}>
              <div className="topic-info">
                <strong>{topic.name}</strong>
                <span>{topicStatus(topic)}</span>
              </div>
              <div className="topic-actions">
                {removing === topic.id ? (
                  <>
                    <button type="button" className="text-button" onClick={() => setRemoving(undefined)}>Cancel</button>
                    <button type="button" className="text-button score-delete" disabled={busy}
                      onClick={() => void update(async () => { await db.topics.delete(topic.id); setRemoving(undefined) })}>
                      Remove topic
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="text-button" disabled={busy}
                      aria-label={(topic.weak ? 'Clear weak status for ' : 'Mark weak: ') + topic.name}
                      onClick={() => void update(() => db.setTopicWeak(topic.id, !topic.weak))}>
                      {topic.weak ? 'Clear weak status' : 'Mark weak'}
                    </button>
                    <button type="button" className="subject-remove" aria-label={'Remove topic ' + topic.name}
                      disabled={busy} onClick={() => setRemoving(topic.id)}>×</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : topics && <p>No topics yet.</p>}
      {error && <p role="alert" className="setup-error">{error}</p>}
      <div className="topic-add">
        <label className="setup-field">
          <span>Topic name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            add()
          }} />
        </label>
        <button type="button" className="editor-confirm" disabled={busy || !name.trim()} onClick={add}>Add topic</button>
      </div>
      <p className="topic-plan-help">To add reviews to an existing plan, rebuild it from Today.</p>
    </div>
  )
}
