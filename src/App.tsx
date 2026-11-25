import { useEffect, useState, useSyncExternalStore } from 'react'
import { Setup } from './components/Setup'
import { Today } from './components/Today'
import { Scores } from './components/Scores'
import { Progress } from './components/Progress'
import { DeviceSettings } from './components/DeviceSettings'
import { db } from './data/db'
import { checkNudge } from './data/reminders'
import type { Exam, Subject } from './data/types'
import { useInstall } from './hooks/useInstall'

const tabs = [
  { id: 'today', label: 'Today', title: 'Today' },
  { id: 'scores', label: 'Scores', title: 'Log a score' },
  { id: 'progress', label: 'Progress', title: 'Progress' },
  { id: 'subjects', label: 'Subjects', title: 'Set up your exam' },
] as const

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function currentTab() {
  return tabs.find((tab) => window.location.hash === '#' + tab.id) ?? tabs[0]
}

type SetupData = { exam?: Exam; subjects: Subject[] }

export function App() {
  const requestedTab = useSyncExternalStore(subscribe, currentTab)
  const [setup, setSetup] = useState<SetupData>()
  const [loadFailed, setLoadFailed] = useState(false)
  const install = useInstall()

  useEffect(() => {
    if (!setup?.exam || !('serviceWorker' in navigator)) return
    const worker = navigator.serviceWorker
    let active = true
    const check = () => { if (active) void checkNudge().catch(() => {}) }
    check()
    void worker.ready.then(check).catch(() => {})
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [setup?.exam])

  useEffect(() => {
    let cancelled = false
    db.transaction('r', db.exams, db.subjects, async () => ({
      exam: await db.exams.get('main'),
      subjects: await db.subjects.orderBy('order').toArray(),
    })).then((data) => {
      if (!cancelled) setSetup(data)
    }).catch(() => {
      if (!cancelled) setLoadFailed(true)
    })
    return () => { cancelled = true }
  }, [])

  const activeTab = setup?.exam ? requestedTab : tabs[3]

  function handleSaved(exam: Exam, subjects: Subject[]) {
    if (!setup?.exam) window.location.hash = 'today'
    setSetup({ exam, subjects })
  }

  return (
    <div className={setup?.exam ? 'app-shell' : 'app-shell app-shell--onboarding'}>
      {setup?.exam && (
        <nav aria-label="Main navigation">
          <div className="desktop-brand"><Brand /></div>
          <ul>
            {tabs.map((tab) => (
              <li key={tab.id}>
                <a href={'#' + tab.id} aria-current={tab === activeTab ? 'page' : undefined}>
                  {tab.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main aria-labelledby="screen-title">
        <div className="page-brand"><Brand /></div>
        {loadFailed ? (
          <>
            <h1 id="screen-title">Pasado</h1>
            <p role="alert">Could not open your local data. Reload the app to try again.</p>
          </>
        ) : !setup ? (
          <h1 id="screen-title">Loading Pasado</h1>
        ) : activeTab.id === 'subjects' ? (
          <>
            <Setup exam={setup.exam} subjects={setup.subjects} onSaved={handleSaved} />
            <DeviceSettings configured={!!setup.exam} installation={install} />
          </>
        ) : activeTab.id === 'today' && setup.exam ? (
          <Today exam={setup.exam} subjects={setup.subjects} />
        ) : activeTab.id === 'scores' && setup.exam ? (
          <Scores exam={setup.exam} subjects={setup.subjects} />
        ) : activeTab.id === 'progress' && setup.exam ? (
          <Progress exam={setup.exam} subjects={setup.subjects} />
        ) : (
          <h1 id="screen-title">{activeTab.title}</h1>
        )}
      </main>
    </div>
  )
}

function Brand() {
  return <span className="brand"><span className="brand-mark" aria-hidden="true">✓</span>pasado</span>
}
