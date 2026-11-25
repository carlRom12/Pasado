import { useSyncExternalStore } from 'react'

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
  return tabs.find((tab) => window.location.hash === '#' + tab.id) ?? tabs[3]
}

export function App() {
  const activeTab = useSyncExternalStore(subscribe, currentTab)

  return (
    <div className="app-shell">
      <nav aria-label="Main navigation">
        <span className="brand">Pasado</span>
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
      <main aria-labelledby="screen-title">
        <h1 id="screen-title">{activeTab.title}</h1>
      </main>
    </div>
  )
}
