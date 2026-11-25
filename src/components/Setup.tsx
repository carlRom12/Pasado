import { liveQuery } from 'dexie'
import { useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent, KeyboardEvent } from 'react'
import { db } from '../data/db'
import { useLocalDay } from '../hooks/useLocalDay'
import { daysToGo } from '../data/plan'
import type { Exam, Preset, Subject } from '../data/types'
import nursing from '../presets/prc-nursing.json'
import { presetCoverageFor, presets } from '../presets'
import { SubjectTopics } from './SubjectTopics'

const colors = [
  '#4B3FD6', '#1FA6A0', '#E0559B', '#E89A00', '#7A7FA8',
  '#857BED', '#58C6C1', '#EE8EBE', '#F6BB55', '#A6ABD0',
]


type Props = {
  exam?: Exam
  subjects: Subject[]
  onSaved: (exam: Exam, subjects: Subject[]) => void
}

type Editor = { id?: string; name: string; weight: string; color: string }

function numberInRange(value: string, minimum: number, maximum: number): number | undefined {
  const number = Number(value)
  return value.trim() && Number.isFinite(number) && number >= minimum && number <= maximum
    ? number : undefined
}

export function Setup({ exam, subjects: savedSubjects, onSaved }: Props) {
  const today = useLocalDay()
  const [name, setName] = useState(exam?.name ?? '')
  const [examDate, setExamDate] = useState(exam?.date ?? '')
  const [mark, setMark] = useState(String(exam?.passingMark ?? 75))
  const [minimum, setMinimum] = useState(exam?.minPerSubject?.toString() ?? '')
  const [presetId, setPresetId] = useState(exam?.presetId)
  const [hasScores, setHasScores] = useState<boolean>()
  const [hours, setHours] = useState(exam?.hoursPerDay ?? 3)
  const [subjects, setSubjects] = useState(savedSubjects)
  const [editor, setEditor] = useState<Editor>()
  const [editorError, setEditorError] = useState('')
  const [draggedId, setDraggedId] = useState<string>()
  const [dropId, setDropId] = useState<string>()
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [setupError, setSetupError] = useState('')
  const examNameField = useRef<HTMLInputElement>(null)
  const examDateField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const subscription = liveQuery(() => db.scores.count()).subscribe({
      next: (count) => setHasScores(count > 0),
      error: () => setHasScores(true),
    })
    return () => subscription.unsubscribe()
  }, [])

  const preset = presets.find(({ id }) => id === presetId)

  function applyPreset(next: Preset) {
    if (subjects.length && !window.confirm('Replace the subjects in this setup with the preset subjects?')) return
    setName(next.name)
    setMark(next.passingMark?.toString() ?? '')
    setMinimum(next.minPerSubject?.toString() ?? '')
    setPresetId(next.id)
    setSubjects(next.subjects.map(({ name, weight }, order) => ({
      name, weight, id: crypto.randomUUID(), order, color: colors[order % colors.length],
    })))
    setEditor(undefined)
    setSaved(false)
    setSetupError('')
    examDateField.current?.focus()
  }

  const days = /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? daysToGo(examDate, today) : undefined
  const total = subjects.reduce((sum, subject) => sum + Math.round(subject.weight * 100), 0) / 100

  function edit(subject?: Subject) {
    setSaved(false)
    setEditorError('')
    const unusedColor = colors.find((color) => !subjects.some((item) => item.color === color))
    setEditor(subject
      ? { id: subject.id, name: subject.name, weight: String(subject.weight), color: subject.color }
      : { name: '', weight: '', color: unusedColor ?? colors[subjects.length % colors.length] })
  }

  function applyEditor() {
    if (!editor) return
    const weight = numberInRange(editor.weight, 0, 100)
    if (!editor.name.trim() || weight === undefined) {
      setEditorError('Enter a subject name and a weight from 0 to 100%.')
      return
    }

    if (Math.round(weight * 100) / 100 !== weight) {
      setEditorError('Use up to two decimal places for the weight.')
      return
    }
    const fields = { name: editor.name.trim(), weight, color: editor.color }
    if (editor.id) {
      setSubjects(subjects.map((subject) => subject.id === editor.id ? { ...subject, ...fields } : subject))
      setMessage(fields.name + ' updated.')
    } else {
      setSubjects([...subjects, { ...fields, id: crypto.randomUUID(), order: subjects.length }])
      setMessage(fields.name + ' added.')
    }
    setEditor(undefined)
    setSetupError('')
  }

  function handleEditorKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'color') {
      event.preventDefault()
      applyEditor()
    }
  }

  function remove(subject: Subject) {
    setSubjects(subjects.filter(({ id }) => id !== subject.id))
    if (editor?.id === subject.id) setEditor(undefined)
    setMessage(subject.name + ' removed.')
    setSaved(false)
  }

  function move(id: string, destination: number) {
    const source = subjects.findIndex((subject) => subject.id === id)
    if (source < 0 || destination < 0 || destination >= subjects.length || source === destination) return
    const ordered = [...subjects]
    const [subject] = ordered.splice(source, 1)
    ordered.splice(destination, 0, subject)
    setSubjects(ordered)
    setMessage(subject.name + ' moved to position ' + (destination + 1) + '.')
    setSaved(false)
  }

  function clearDrag() {
    setDraggedId(undefined)
    setDropId(undefined)
  }

  function drop(event: DragEvent<HTMLLIElement>, destination: number) {
    if (!draggedId) return
    event.preventDefault()
    move(draggedId, destination)
    clearDrag()
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || editor) return
    const passingMark = numberInRange(mark, 0, 100)
    const minPerSubject = numberInRange(minimum, 0, 100)
    if (minimum !== '' && minPerSubject === undefined) {
      setSetupError('Enter a minimum per subject from 0 to 100%, or leave it blank.')
      return
    }
    if (passingMark === undefined || !name.trim() || days === undefined) {
      setSetupError('Enter an exam name, a valid date, and a passing mark from 0 to 100%.')
      return
    }
    if (days < 0) {
      setSetupError('Choose today or a later exam date.')
      return
    }
    if (!exam && !subjects.length) {
      setSetupError('Add your first subject to build a plan.')
      return
    }

    const nextExam: Exam = { id: 'main', name: name.trim(), date: examDate, passingMark, hoursPerDay: hours,
      ...(minPerSubject === undefined ? {} : { minPerSubject }), ...(presetId ? { presetId } : {}) }
    const nextSubjects = subjects.map((subject, order) => ({ ...subject, order }))
    setSaving(true)
    setSaved(false)
    setSetupError('')
    try {
      await db.saveSetup(nextExam, nextSubjects)
      onSaved(nextExam, nextSubjects)
      setSaved(true)
    } catch (failure) {
      setSetupError(failure instanceof RangeError ? failure.message : 'Could not save your setup. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="setup" onSubmit={save} onChange={() => setSaved(false)}>
      <header className="setup-heading">
        <h1 id="screen-title">Set up your exam</h1>
        {!exam && <p>Takes a minute. You can change everything later.</p>}
      </header>

      <fieldset disabled={saving} className="setup-fields">
        {hasScores === false && !preset && (
          <section className="device-card" aria-labelledby="preset-picker-title">
            <h2 id="preset-picker-title">Start from an exam preset</h2>
            {presets.map((item) => (
              <button key={item.id} type="button" className="editor-confirm" onClick={() => applyPreset(item)}>{item.name}</button>
            ))}
            <button type="button" className="text-button" onClick={() => examNameField.current?.focus()}>Set up manually</button>
          </section>
        )}
        {preset && (
          <section className="device-card" aria-labelledby="preset-title">
            <h2 id="preset-title">{preset.name}</h2>
            <p>Source: {preset.authority}{preset.id === nursing.id ? ' / RA 9173 §15' : ''} · last checked <time dateTime={preset.lastChecked}>{preset.lastChecked}</time></p>
            {preset.weightsAssumed && (
              <p className="preset-caution"><span aria-hidden="true">⚠</span> Weights assumed. Check your exam's syllabus.</p>
            )}
            <details className="preset-sources nursing-coverage">
                <summary>{preset.id === nursing.id ? 'Nursing Practice I–V coverage' : 'CELE subject coverage'}</summary>
                <dl>
                  {preset.subjects.map(({ name }) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>{presetCoverageFor(preset.id, name)}</dd>
                    </div>
                  ))}
                </dl>
                {preset.id === nursing.id && <a href="https://www.prc.gov.ph/sites/default/files/exam%20progam%20aug%202026%20nle%20%28nursing%29%20signed.pdf"
                  target="_blank" rel="noreferrer">August 2026 PRC exam program</a>}
            </details>
            <details className="preset-sources">
              <summary>See sources</summary>
              <ul>{preset.sources.map(({ label, url }) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{label}</a></li>)}</ul>
              {preset.notes && <ul>{preset.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
            </details>
          </section>
        )}
        <label className="setup-field">
          <span>Exam name</span>
          <input ref={examNameField} value={name} onChange={(event) => setName(event.target.value)} placeholder="My board exam" required />
        </label>
        <div className="setup-field-row">
          <label className="setup-field">
            <span>Exam date</span>
            <input ref={examDateField} type="date" min={today} max="9999-12-31" value={examDate}
              onChange={(event) => setExamDate(event.target.value)} required />
          </label>
          <label className="setup-field">
              <span>{preset && preset.passingMark === undefined ? 'Study target' : 'Passing mark'}</span>
            <span className="setup-percent">
              <input type="number" min="0" max="100" step="any" value={mark} onChange={(event) => setMark(event.target.value)} required />
              <span aria-hidden="true">%</span>
            </span>
              {preset && preset.passingMark === undefined && <small>Enter your own target for mock exams.</small>}
          </label>
        </div>

        <label className="setup-field">
          <span id="minimum-label">Minimum per subject (optional)</span>
          <span className="setup-percent">
            <input type="number" min="0" max="100" step="any" value={minimum} aria-labelledby="minimum-label" aria-describedby="minimum-help"
              onChange={(event) => setMinimum(event.target.value)} />
            <span aria-hidden="true">%</span>
          </span>
          <small id="minimum-help">Some exams also require a minimum score in every subject. Leave blank if yours doesn't.</small>
        </label>

        <div className="study-card">
          <div>
            <h2 id="study-time">Study time per day</h2>
            <p aria-live="polite">
              {days === undefined ? 'Choose your exam date' : days < 0 ? 'Exam day passed. Set a new date.'
                : days === 0 ? 'Exam day is today' : 'About ' + days + (days === 1 ? ' day to go' : ' days to go')}
            </p>
          </div>
          <div className="study-stepper" role="group" aria-labelledby="study-time">
            <button type="button" aria-label="Decrease study time" disabled={hours <= 1} onClick={() => { setHours(hours - 0.5); setSaved(false) }}>−</button>
            <output aria-live="polite">{hours} h</output>
            <button type="button" aria-label="Increase study time" disabled={hours >= 12} onClick={() => { setHours(hours + 0.5); setSaved(false) }}>+</button>
          </div>
        </div>

        <section className="subject-section" aria-labelledby="subject-title">
          <div className="subject-heading">
            <h2 id="subject-title">Your subjects</h2>
            <p className={total === 100 ? 'weight-total weight-total--valid' : 'weight-total'} aria-live="polite">
              Total {total}% <span aria-hidden="true">{total === 100 ? '✓' : '⚠'}</span>
              <span className="sr-only">{total === 100 ? ' (complete)' : ' (check weights)'}</span>
            </p>
          </div>
          <p className="subject-help">
            Weight is how much a subject counts toward your overall score. Use the numbers from your exam's official syllabus or table of specifications.
            If your exam doesn't weight subjects, give them equal weights. Pasado also uses weights to decide what to study first: it multiplies each subject's weight by how far you are below your passing mark.
          </p>
          {!!subjects.length && total === 0 ? (
            <p className="weight-note">Give at least one subject a weight above 0% to build a focus plan.</p>
          ) : !!subjects.length && total !== 100 && (
            <p className="weight-note">Weights add up to {total}%. Pasado adjusts the calculation using the weights you enter.</p>
          )}

          <div className="subject-card">
            {subjects.length ? (
              <ul className="subject-list">
                {subjects.map((subject, index) => (
                  <li key={subject.id} className={dropId === subject.id ? 'subject-row subject-row--drop' : 'subject-row'}
                    onDragOver={(event) => {
                      if (!draggedId) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDropId(subject.id)
                    }}
                    onDrop={(event) => drop(event, index)}>
                    <button type="button" className="subject-handle" draggable={subjects.length > 1}
                      aria-label={'Reorder ' + subject.name} title="Drag to reorder or use the arrow keys"
                      onClick={() => edit(subject)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', subject.id)
                        setDraggedId(subject.id)
                      }}
                      onDragEnd={clearDrag}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                        event.preventDefault()
                        move(subject.id, index + (event.key === 'ArrowUp' ? -1 : 1))
                      }}><span aria-hidden="true">⠿</span></button>
                    <span className="subject-dot" style={{ backgroundColor: subject.color }} aria-hidden="true" />
                    <span className="subject-name">{subject.name}</span>
                    <button type="button" className="weight-pill" aria-label={'Edit ' + subject.name + ', weight ' + subject.weight + '%'}
                      aria-expanded={editor?.id === subject.id} onClick={() => edit(subject)}>{subject.weight}%</button>
                    <button type="button" className="subject-remove" aria-label={'Remove ' + subject.name} onClick={() => remove(subject)}>×</button>
                    {savedSubjects.some(({ id }) => id === subject.id) && <SubjectTopics subject={subject} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="subject-empty">Add your first subject</p>
            )}
            {editor ? (
              <section className="subject-editor" aria-label={editor.id ? 'Edit subject' : 'Add subject'} onKeyDown={handleEditorKey}>
                <h3>{editor.id ? 'Edit subject' : 'Add subject'}</h3>
                <div className="editor-fields">
                  <label className="setup-field">
                    <span>Subject name</span>
                    <input key={editor.id ?? 'new'} autoFocus value={editor.name}
                      onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
                  </label>
                  <label className="setup-field">
                    <span>Weight</span>
                    <span className="setup-percent">
                      <input type="number" min="0" max="100" step="0.01" value={editor.weight}
                        onChange={(event) => setEditor({ ...editor, weight: event.target.value })} />
                      <span aria-hidden="true">%</span>
                    </span>
                  </label>
                  <label className="setup-field editor-color">
                    <span>Color</span>
                    <input type="color" value={editor.color} onChange={(event) => setEditor({ ...editor, color: event.target.value })} />
                  </label>
                </div>
                {editor.id && subjects.length > 1 && (
                  <div className="editor-actions" role="group" aria-label="Reorder subject">
                    <button type="button" className="text-button" disabled={subjects[0].id === editor.id}
                      onClick={() => move(editor.id!, subjects.findIndex(({ id }) => id === editor.id) - 1)}>Move up</button>
                    <button type="button" className="text-button" disabled={subjects.at(-1)?.id === editor.id}
                      onClick={() => move(editor.id!, subjects.findIndex(({ id }) => id === editor.id) + 1)}>Move down</button>
                  </div>
                )}
                {editorError && <p className="setup-error" role="alert">{editorError}</p>}
                <div className="editor-actions">
                  <button type="button" className="text-button" onClick={() => setEditor(undefined)}>Cancel</button>
                  <button type="button" className="editor-confirm" onClick={applyEditor}>{editor.id ? 'Apply changes' : 'Add to list'}</button>
                </div>
              </section>
            ) : (
              <button type="button" className="add-subject" onClick={() => edit()}><span aria-hidden="true">+</span> Add subject</button>
            )}
          </div>
          <p className="sr-only" role="status">{message}</p>
        </section>
      </fieldset>
      <footer className="setup-footer">
        {setupError && <p className="setup-error" role="alert">{setupError}</p>}
        {saved && <p className="setup-saved" role="status">Exam setup saved.</p>}
        <button type="submit" className="setup-primary" disabled={saving || !!editor}>
          {saving ? 'Saving…' : exam ? 'Save' : 'Build my plan'}
        </button>
        <p>Pasado plans your study. Use your reviewer app, books or review center for the content.</p>
      </footer>
    </form>
  )
}
