import { format, isValid, parseISO } from 'date-fns'

export function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function parseDateKey(value: string): Date {
  const date = parseISO(value)
  if (!isValid(date) || dateKey(date) !== value) {
    throw new RangeError('Use a valid date in yyyy-MM-dd format.')
  }
  return date
}
