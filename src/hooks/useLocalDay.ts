import { addDays, startOfDay } from 'date-fns'
import { useEffect, useState } from 'react'
import { dateKey } from '../data/dates'

export function useLocalDay() {
  const [day, setDay] = useState(() => dateKey(new Date()))

  useEffect(() => {
    let timer: number
    function refresh() {
      window.clearTimeout(timer)
      const now = new Date()
      setDay(dateKey(now))
      const midnight = startOfDay(addDays(now, 1)).getTime()
      timer = window.setTimeout(refresh, midnight - now.getTime())
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return day
}
