import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { exportBackup, parseBackup, restoreBackup } from '../data/backup'
import { dateKey } from '../data/dates'
import { db } from '../data/db'
import { checkNudge, defaultReminders, isReminderTime } from '../data/reminders'
import type { useInstall } from '../hooks/useInstall'

export function DeviceSettings({ configured, installation }: {
  configured: boolean
  installation: ReturnType<typeof useInstall>
}) {
  const [installHelp, setInstallHelp] = useState(false)

  async function install() {
    setInstallHelp(!await installation.install())
  }

  return (
    <div className="device-settings">
      {configured && <Reminders />}
      <section className="device-card" aria-labelledby="install-title">
        <h2 id="install-title">Install Pasado</h2>
        {installation.installed ? <p>Pasado is installed on this device.</p> : (
          <>
            <button type="button" className="editor-confirm" onClick={() => void install()}>Install app</button>
            {installHelp && <p role="status">Open your browser menu and choose Install app or Add to Home Screen. On iPhone or iPad, use Safari’s Share menu.</p>}
          </>
        )}
      </section>
      <BackupSettings />
    </div>
  )
}

function Reminders() {
  const [settings, setSettings] = useState(defaultReminders)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    db.settings.get('reminders').then((stored) => {
      if (active) {
        setSettings(stored ?? defaultReminders)
        setLoading(false)
      }
    }).catch(() => {
      if (active) setError('Could not load your reminder settings.')
    })
    return () => { active = false }
  }, [])

  async function save(enabled: boolean, time: string) {
    if (!isReminderTime(time)) return
    setBusy(true)
    setError('')
    try {
      const saved = await db.transaction('rw', db.settings, async () => {
        const current = await db.settings.get('reminders') ?? defaultReminders
        const next = { ...current, enabled, time }
        await db.settings.put(next)
        return next
      })
      setSettings(saved)
      void checkNudge().catch(() => {})
    } catch {
      setError('Could not save your reminder settings.')
    } finally {
      setBusy(false)
    }
  }

  async function requestNotifications() {
    try {
      setPermission(await Notification.requestPermission())
      void checkNudge().catch(() => {})
    } catch {
      setError('Could not request notification permission.')
    }
  }

  return (
    <section className="device-card" aria-labelledby="reminder-title">
      <h2 id="reminder-title">Daily reminder</h2>
      <p>Pasado can remind you about unfinished tasks when you open or return to the app after your chosen time.</p>
      <fieldset className="reminder-fields" disabled={loading || busy}>
        <label className="reminder-toggle">
          <input type="checkbox" checked={settings.enabled} onChange={(event) => void save(event.target.checked, settings.time)} />
          Daily nudge
        </label>
        <label className="setup-field">
          <span>Reminder time</span>
          <input type="time" value={settings.time} onChange={(event) => void save(settings.enabled, event.target.value)} />
        </label>
      </fieldset>
      {settings.enabled && permission === 'default' && (
        <button type="button" className="editor-confirm" onClick={() => void requestNotifications()}>Allow notifications</button>
      )}
      {settings.enabled && permission === 'denied' && <p>To receive reminders, allow notifications in your browser settings.</p>}
      {settings.enabled && permission === 'unsupported' && <p>Notifications are unavailable in this browser.</p>}
      {error && <p role="alert" className="setup-error">{error}</p>}
    </section>
  )
}

function BackupSettings() {
  const [pending, setPending] = useState<{ name: string; text: string }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileField = useRef<HTMLInputElement>(null)

  async function download() {
    setError('')
    setBusy(true)
    try {
      const backup = await exportBackup(db)
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'pasado-backup-' + dateKey(new Date()) + '.json'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError('Could not export your backup.')
    } finally {
      setBusy(false)
    }
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setPending(undefined)
    setBusy(true)
    try {
      const text = await file.text()
      parseBackup(text)
      setPending({ name: file.name, text })
    } catch {
      setError('Choose a valid JSON backup exported by Pasado.')
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    if (!pending) return
    setError('')
    setBusy(true)
    try {
      await restoreBackup(db, pending.text)
      window.location.hash = 'subjects'
      window.location.reload()
    } catch {
      setError('Could not restore your backup. Your current data was kept.')
      setBusy(false)
    }
  }

  return (
    <section className="device-card" aria-labelledby="backup-title">
      <h2 id="backup-title">Your data</h2>
      <p>Data stays on this device. Export a backup before changing phones.</p>
      <div className="device-actions">
        <button type="button" className="editor-confirm" disabled={busy} onClick={() => void download()}>Export backup</button>
        <button type="button" className="editor-confirm" disabled={busy} onClick={() => fileField.current?.click()}>Import backup</button>
        <input ref={fileField} type="file" accept=".json,application/json" hidden onChange={(event) => void selectFile(event)} />
      </div>
      {pending && (
        <div className="restore-warning">
          <p>Restoring <strong>{pending.name}</strong> will replace all Pasado data on this device.</p>
          <div className="device-actions">
            <button type="button" className="text-button" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button>
            <button type="button" className="editor-confirm" disabled={busy} onClick={() => void restore()}>Restore backup</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="setup-error">{error}</p>}
    </section>
  )
}
