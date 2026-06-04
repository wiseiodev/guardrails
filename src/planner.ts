import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { CONFIG_FILE, serializeConfig } from './config.js'
import { PACKAGE_VERSION } from './constants.js'
import { sha256 } from './hash.js'
import {
  agentsTemplate,
  biomeTemplate,
  checksWorkflowTemplate,
  commitlintTemplate,
  lefthookTemplate,
  managedPackageJson,
  manifestTemplate,
  mergeManagedBlock,
  pullRequestTemplate,
  safetyHookTemplate,
} from './templates.js'
import type {
  GuardrailsConfig,
  GuardrailsPlan,
  LocalChange,
  PlannedFile,
  PlannedPackageJson,
  PlannedRemoteAction,
  PlannedSymlink,
  RepoInspection,
} from './types.js'

export function createPlan(inspection: RepoInspection, config: GuardrailsConfig): GuardrailsPlan {
  const warnings = warningList(inspection)
  const localChanges: LocalChange[] = []
  const hasManifest = existsSync(path.join(inspection.cwd, '.guardrails/manifest.json'))

  localChanges.push(planPackageJson(inspection, config))
  localChanges.push(
    planFile(inspection.cwd, CONFIG_FILE, serializeConfig(config), false, hasManifest)
  )
  localChanges.push(
    planFile(inspection.cwd, '.nvmrc', `${config.runtime.node}\n`, false, hasManifest)
  )
  localChanges.push(
    planFile(inspection.cwd, 'biome.json', biomeTemplate(inspection), true, hasManifest)
  )
  localChanges.push(planFile(inspection.cwd, 'lefthook.yml', lefthookTemplate(), true, hasManifest))
  localChanges.push(
    planFile(inspection.cwd, 'commitlint.config.cjs', commitlintTemplate(config), true, hasManifest)
  )

  if (config.github.checksWorkflow) {
    localChanges.push(
      planFile(
        inspection.cwd,
        '.github/workflows/checks.yml',
        checksWorkflowTemplate(inspection),
        true,
        hasManifest
      )
    )
    localChanges.push(
      planFile(
        inspection.cwd,
        '.github/pull_request_template.md',
        pullRequestTemplate(config),
        true,
        hasManifest
      )
    )
  }

  if (config.agents.enabled) {
    const agentsPath = path.join(inspection.cwd, 'AGENTS.md')
    const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : null
    localChanges.push({
      kind: 'file',
      path: 'AGENTS.md',
      action: fileAction(existing, mergeManagedBlock(existing, agentsTemplate(config)), true, true),
      reason: existing
        ? 'Update managed AGENTS.md guardrails block.'
        : 'Create AGENTS.md guardrails block.',
      managed: true,
      content: mergeManagedBlock(existing, agentsTemplate(config)),
    })

    if (config.agents.symlinks) {
      localChanges.push(planSymlink(inspection.cwd, 'CLAUDE.md', 'AGENTS.md'))
      localChanges.push(
        planSymlink(inspection.cwd, '.github/copilot-instructions.md', '../AGENTS.md')
      )
    }

    if (config.agents.safetyHooks) {
      localChanges.push(
        planFile(
          inspection.cwd,
          '.codex/hooks/block-dangerous-commands.sh',
          safetyHookTemplate(),
          true,
          hasManifest
        )
      )
      localChanges.push(
        planFile(
          inspection.cwd,
          '.claude/hooks/block-dangerous-commands.sh',
          safetyHookTemplate(),
          true,
          hasManifest
        )
      )
    }
  }

  const planHash = sha256(
    JSON.stringify(
      localChanges.map((change) => ({
        kind: change.kind,
        path: change.path,
        desired:
          change.kind === 'symlink'
            ? change.target
            : change.kind === 'package-json'
              ? change.content
              : change.content,
      }))
    )
  )
  localChanges.push(planManifest(inspection.cwd, planHash))

  const remoteActions = remoteActionList(config)
  const conflicts = collectConflicts(localChanges)

  return {
    schemaVersion: 1,
    cwd: inspection.cwd,
    packageVersion: PACKAGE_VERSION,
    config,
    inspection,
    localChanges,
    remoteActions,
    warnings,
    conflicts,
  }
}

function planPackageJson(inspection: RepoInspection, config: GuardrailsConfig): PlannedPackageJson {
  const { content, conflicts } = managedPackageJson(inspection, config)
  return {
    kind: 'package-json',
    path: 'package.json',
    action: conflicts.length > 0 ? 'conflict' : packageJsonAction(inspection, content),
    reason: inspection.hasPackageJson
      ? 'Merge guardrails scripts, devDependencies, packageManager, and engines.'
      : 'Create package.json with guardrails scripts and devDependencies.',
    content,
    conflicts,
  }
}

function planFile(
  cwd: string,
  relativePath: string,
  content: string,
  managed: boolean,
  hasManifest: boolean
): PlannedFile {
  const absolutePath = path.join(cwd, relativePath)
  const existing = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null
  const action = fileAction(existing, content, managed, hasManifest)

  return {
    kind: 'file',
    path: relativePath,
    action,
    reason: reasonForFile(relativePath, existing, action),
    managed,
    content,
  }
}

function planManifest(cwd: string, planHash: string): PlannedFile {
  const relativePath = '.guardrails/manifest.json'
  const absolutePath = path.join(cwd, relativePath)
  if (existsSync(absolutePath)) {
    const existing = readFileSync(absolutePath, 'utf8')
    try {
      const parsed = JSON.parse(existing) as { packageVersion?: string; planHash?: string }
      if (parsed.packageVersion === PACKAGE_VERSION && parsed.planHash === planHash) {
        return {
          kind: 'file',
          path: relativePath,
          action: 'skip',
          reason: `${relativePath} is already current.`,
          managed: true,
          content: existing,
        }
      }
    } catch {
      // Fall through and replace malformed managed metadata.
    }
  }

  return planFile(cwd, relativePath, manifestTemplate(planHash), true, true)
}

function planSymlink(cwd: string, relativePath: string, target: string): PlannedSymlink {
  const absolutePath = path.join(cwd, relativePath)
  if (!existsSync(absolutePath)) {
    return {
      kind: 'symlink',
      path: relativePath,
      action: 'create',
      reason: `Create symlink to ${target}.`,
      target,
    }
  }

  const stat = lstatSync(absolutePath)
  if (stat.isSymbolicLink()) {
    return {
      kind: 'symlink',
      path: relativePath,
      action: 'skip',
      reason: 'Symlink already exists.',
      target,
    }
  }

  return {
    kind: 'symlink',
    path: relativePath,
    action: 'conflict',
    reason: 'A non-symlink file already exists at this path.',
    target,
  }
}

function fileAction(
  existing: string | null,
  desired: string,
  managed: boolean,
  hasManifest: boolean
): PlannedFile['action'] {
  if (existing === null) return 'create'
  if (existing === desired) return 'skip'
  return managed && hasManifest ? 'update' : 'conflict'
}

function packageJsonAction(
  inspection: RepoInspection,
  desired: unknown
): PlannedPackageJson['action'] {
  if (!inspection.packageJson) return 'create'
  return JSON.stringify(inspection.packageJson) === JSON.stringify(desired) ? 'skip' : 'update'
}

function reasonForFile(relativePath: string, existing: string | null, action: string): string {
  if (action === 'skip') return `${relativePath} is already current.`
  if (action === 'conflict') return `${relativePath} already exists and is not marked as managed.`
  return existing ? `Update managed ${relativePath}.` : `Create ${relativePath}.`
}

function warningList(inspection: RepoInspection): string[] {
  const warnings: string[] = []
  if (inspection.existingTools.eslint)
    warnings.push('Existing ESLint config detected; review migration plan.')
  if (inspection.existingTools.prettier)
    warnings.push('Existing Prettier config detected; review migration plan.')
  if (inspection.existingTools.husky)
    warnings.push('Existing Husky hooks detected; review migration plan.')
  if (inspection.existingTools.lintStaged) {
    warnings.push('Existing lint-staged config detected; review migration plan.')
  }
  if (inspection.packageManager && !inspection.packageManager.startsWith('pnpm@')) {
    warnings.push(
      `Existing packageManager is ${inspection.packageManager}; v1 officially supports pnpm.`
    )
  }
  return warnings
}

function collectConflicts(localChanges: LocalChange[]): string[] {
  const conflicts: string[] = []
  for (const change of localChanges) {
    if (change.action === 'conflict') {
      conflicts.push(`${change.path}: ${change.reason}`)
    }
    if (change.kind === 'package-json') {
      conflicts.push(...change.conflicts)
    }
  }
  return conflicts
}

function remoteActionList(config: GuardrailsConfig): PlannedRemoteAction[] {
  if (!config.github.ruleset.enabled) {
    return [
      {
        kind: 'github-ruleset',
        action: 'skip',
        reason: 'GitHub ruleset planning is disabled in config.',
        settings: {},
      },
    ]
  }

  return [
    {
      kind: 'github-ruleset',
      action: 'propose',
      reason: config.github.ruleset.apply
        ? 'Ruleset can be applied by a future remote apply command.'
        : 'Ruleset is proposed only; remote apply is disabled.',
      settings: {
        target: '~DEFAULT_BRANCH',
        rules: [
          'deletion',
          'non_fast_forward',
          'pull_request:required_review_thread_resolution',
          'required_status_checks:checks',
        ],
        requiredApprovingReviewCount: 0,
      },
    },
  ]
}
