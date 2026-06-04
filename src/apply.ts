import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ApplyResult, GuardrailsPlan, LocalChange } from './types.js'

export function applyPlan(plan: GuardrailsPlan): ApplyResult {
  const result: ApplyResult = {
    cwd: plan.cwd,
    applied: [],
    skipped: [],
    conflicts: [...plan.conflicts],
  }

  if (result.conflicts.length > 0) return result

  for (const change of plan.localChanges) {
    applyChange(plan.cwd, change, result)
  }

  return result
}

function applyChange(cwd: string, change: LocalChange, result: ApplyResult): void {
  if (change.action === 'skip') {
    result.skipped.push({ path: change.path, reason: change.reason })
    return
  }

  if (change.action === 'conflict') {
    result.conflicts.push(`${change.path}: ${change.reason}`)
    return
  }

  const absolutePath = path.join(cwd, change.path)
  mkdirSync(path.dirname(absolutePath), { recursive: true })

  if (change.kind === 'symlink') {
    symlinkSync(change.target, absolutePath)
    result.applied.push({ path: change.path, action: change.action })
    return
  }

  if (change.kind === 'package-json') {
    writeFileSync(absolutePath, `${JSON.stringify(change.content, null, 2)}\n`)
    result.applied.push({ path: change.path, action: change.action })
    return
  }

  writeFileSync(absolutePath, change.content)
  result.applied.push({ path: change.path, action: change.action })
}
