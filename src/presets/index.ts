import type { Preset } from '../data/types'
import civilEngineering from './prc-cele.json'
import nursing from './prc-nursing.json'
import { nursingCoverageFor } from './nursingCoverage'

export const presets: readonly Preset[] = [nursing, civilEngineering]

export function presetUsesStudyTarget(presetId: string | undefined): boolean {
  return presets.some(({ id, passingMark }) => id === presetId && passingMark === undefined)
}

export function presetCoverageFor(presetId: string | undefined, name: string): string | undefined {
  if (presetId === nursing.id) return nursingCoverageFor(presetId, name)
  return presetSubject(presetId, name)?.coverage
}

export function presetSubject(presetId: string | undefined, name: string) {
  return presets.find(({ id }) => id === presetId)?.subjects.find((subject) => subject.name === name)
}
