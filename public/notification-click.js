self.addEventListener('notificationclick', (event) => {
  if (event.notification.tag !== 'pasado-daily-nudge') return
  event.notification.close()
  const target = new URL('#today', self.registration.scope).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => client.url.split('#')[0] === self.registration.scope)
    if (existing) {
      await existing.navigate(target)
      await existing.focus()
    } else {
      await self.clients.openWindow(target)
    }
  })())
})
