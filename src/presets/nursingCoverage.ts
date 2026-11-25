import nursing from './prc-nursing.json'

const nursingCoverage = [
  'Community health nursing for individuals, families, population groups, and communities.',
  'Maternal and child health, including adolescent care, plus human growth and development.',
  'Medical-surgical nursing covering surgery, oxygenation, fluids and electrolytes, infection, inflammation, immune responses, and cellular changes.',
  'Medical-surgical nursing covering nutrition, gastrointestinal care, metabolism, endocrine disorders, perception, and coordination.',
  'Psychiatric and mental health nursing, plus emergency and critical care for patients with life-threatening conditions or acute multi-organ problems.',
]

export function nursingCoverageFor(presetId: string | undefined, subjectName: string) {
  if (presetId !== nursing.id) return undefined
  return nursingCoverage[nursing.subjects.findIndex(({ name }) => name === subjectName)]
}
