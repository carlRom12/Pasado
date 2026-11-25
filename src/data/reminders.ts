import { format } from 'date-fns'
import { dateKey } from './dates'
import { db } from './db'
import type { ReminderSettings } from './types'

export const defaultReminders: ReminderSettings = { id: 'reminders', enabled: true, time: '08:00' }

export function isReminderTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export async function checkNudge(now = new Date()) {
  if (document.visibilityState === 'hidden' || !('serviceWorker' in navigator)
    || typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const day = dateKey(now)
  const time = format(now, 'HH:mm')
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration?.active) return

  const settings = await db.settings.get('reminders') ?? defaultReminders
  if (!settings.enabled || time < settings.time || settings.lastSentOn === day) return
  await db.getTodayPlan(now)
  const claim = await db.transaction('rw', db.settings, db.tasks, async () => {
    const current = await db.settings.get('reminders') ?? defaultReminders
    if (!current.enabled || time < current.time || current.lastSentOn === day) return
    const pending = await db.tasks.where('date').equals(day).filter((task) => task.doneAt === undefined).count()
    if (!pending) return
    await db.settings.put({ ...current, lastSentOn: day })
    return { pending, previous: current.lastSentOn }
  })
  if (!claim) return

  try {
    await registration.showNotification('Pasado daily reminder', {
      body: claim.pending === 1 ? 'You have one study task left today.' : 'You have ' + claim.pending + ' study tasks left today.',
      icon: new URL('icons/pasado-192.png', registration.scope).href,
      tag: 'pasado-daily-nudge',
    })
  } catch {
    await db.transaction('rw', db.settings, async () => {
      const current = await db.settings.get('reminders')
      if (current?.lastSentOn === day) await db.settings.put({ ...current, lastSentOn: claim.previous })
    })
  }
}
