import { useEffect, useState } from 'react'

type InstallPrompt = Event & {
  prompt: () => Promise<unknown>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone() {
  const appleNavigator = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || appleNavigator.standalone === true
}

export function useInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    function capture(event: Event) {
      event.preventDefault()
      setPrompt(event as InstallPrompt)
    }
    function complete() {
      setPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', complete)
    return () => {
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('appinstalled', complete)
    }
  }, [])

  async function install(): Promise<boolean> {
    if (!prompt) return false
    setPrompt(null)
    try {
      await prompt.prompt()
      if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true)
      return true
    } catch {
      return false
    }
  }

  return { installed, install }
}
