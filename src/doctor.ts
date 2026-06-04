import type { GuardrailsPlan } from './types.js'

export interface DoctorReport {
  ok: boolean
  current: number
  pending: number
  conflicts: string[]
  warnings: string[]
}

export function doctorReport(plan: GuardrailsPlan): DoctorReport {
  const current = plan.localChanges.filter((change) => change.action === 'skip').length
  const pending = plan.localChanges.filter(
    (change) => change.action === 'create' || change.action === 'update'
  ).length

  return {
    ok: plan.conflicts.length === 0 && pending === 0,
    current,
    pending,
    conflicts: plan.conflicts,
    warnings: plan.warnings,
  }
}
