import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPlan } from '../src/apply.js'
import { trackerFooterPattern } from '../src/commitlint.js'
import { CONFIG_FILE, defaultConfig, loadConfig } from '../src/config.js'
import { PLAN_FILE } from '../src/constants.js'
import { doctorReport } from '../src/doctor.js'
import { inspectRepo } from '../src/inspect.js'
import { createPlan } from '../src/planner.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('guardrails planning', () => {
  it('plans and applies core hygiene files for a clean pnpm repo', () => {
    const repo = tempRepo()
    writeJson(path.join(repo, 'package.json'), {
      name: 'demo',
      version: '0.1.0',
      private: true,
      packageManager: 'pnpm@11.5.0',
      scripts: {
        build: 'tsc',
        test: 'vitest run',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        next: '16.2.6',
        react: '19.2.4',
      },
    })
    writeFileSync(path.join(repo, '.nvmrc'), '24.16.0\n')

    const inspection = inspectRepo(repo)
    const plan = createPlan(inspection, defaultConfig(inspection))

    expect(plan.conflicts).toEqual([])
    expect(plan.localChanges.some((change) => change.path === 'biome.json')).toBe(true)

    const packageChange = plan.localChanges.find((change) => change.kind === 'package-json')
    expect(packageChange?.action).toBe('update')
    if (packageChange?.kind !== 'package-json') throw new Error('package-json change missing')
    expect(packageChange.content.scripts?.checks).toBe(
      'pnpm lint && pnpm typecheck && pnpm test && pnpm build'
    )

    const biomeChange = plan.localChanges.find((change) => change.path === 'biome.json')
    if (biomeChange?.kind !== 'file') throw new Error('biome change missing')
    expect(biomeChange.content).toContain('"next": "recommended"')

    const result = applyPlan(plan)

    expect(result.conflicts).toEqual([])
    expect(existsSync(path.join(repo, 'biome.json'))).toBe(true)
    expect(existsSync(path.join(repo, 'lefthook.yml'))).toBe(true)
    expect(existsSync(path.join(repo, 'commitlint.config.cjs'))).toBe(true)
    expect(existsSync(path.join(repo, '.github/workflows/checks.yml'))).toBe(true)
    expect(existsSync(path.join(repo, 'AGENTS.md'))).toBe(true)

    const after = inspectRepo(repo)
    const doctor = doctorReport(createPlan(after, defaultConfig(after)))
    expect(doctor.ok).toBe(true)
  })

  it('loads JSONC config comments and tracker overrides', () => {
    const repo = tempRepo()
    writeFileSync(
      path.join(repo, CONFIG_FILE),
      `{
        // Jira projects use uppercase keys.
        "tracker": {
          "provider": "jira",
          "keyPattern": "ENG-\\\\d+"
        }
      }
      `
    )

    const inspection = inspectRepo(repo)
    const config = loadConfig(repo, inspection)

    expect(config.tracker.provider).toBe('jira')
    expect(config.tracker.keyPattern).toBe('ENG-\\d+')
  })
})

describe('guardrails CLI', () => {
  it('prints help for agent discovery', () => {
    const result = runGuardrails(['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('guardrails init')
    expect(result.stdout).toContain('guardrails plan')
    expect(result.stdout).toContain('guardrails apply --yes')
    expect(result.stdout).toContain('guardrails doctor')
  })

  it('returns an error for unknown commands', () => {
    const result = runGuardrails(['wat'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown command "wat".')
    expect(result.stdout).toContain('Usage:')
  })

  it('initializes config for a consumer repo', () => {
    const repo = tempRepo()
    writeConsumerPackageJson(repo)

    const result = runGuardrails(['init', '--cwd', repo, '--json'])
    const payload = parseJson<{ command: string; configPath: string; created: boolean }>(
      result.stdout
    )

    expect(result.status).toBe(0)
    expect(payload).toMatchObject({
      command: 'init',
      configPath: CONFIG_FILE,
      created: true,
    })
    expect(existsSync(path.join(repo, CONFIG_FILE))).toBe(true)
  })

  it('saves the JSON plan object for a consumer repo', () => {
    const repo = tempRepo()
    writeConsumerPackageJson(repo)

    const result = runGuardrails(['plan', '--cwd', repo, '--json'])
    const printedPlan = parseJson<{ cwd: string; schemaVersion: number }>(result.stdout)
    const savedPlan = readJson<{ cwd: string; schemaVersion: number }>(path.join(repo, PLAN_FILE))

    expect(result.status).toBe(0)
    expect(savedPlan).toEqual(printedPlan)
    expect(savedPlan.cwd).toBe(repo)
    expect(savedPlan.schemaVersion).toBe(1)
  })

  it('prints the JSON plan before reporting persistence failures', () => {
    const repo = tempRepo()
    writeConsumerPackageJson(repo)
    writeFileSync(path.join(repo, '.guardrails'), 'not a directory\n')

    const result = runGuardrails(['plan', '--cwd', repo, '--json'])
    const printedPlan = parseJson<{ cwd: string; schemaVersion: number }>(result.stdout)

    expect(result.status).toBe(1)
    expect(printedPlan).toMatchObject({ cwd: repo, schemaVersion: 1 })
    expect(result.stderr).toContain('.guardrails')
  })

  it('refuses to apply without explicit approval', () => {
    const repo = tempRepo()
    writeConsumerPackageJson(repo)

    const result = runGuardrails(['apply', '--cwd', repo, '--json'])

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Refusing to apply without --yes.')
    expect(existsSync(path.join(repo, 'AGENTS.md'))).toBe(false)
    expect(existsSync(path.join(repo, '.guardrails/manifest.json'))).toBe(false)
  })

  it('applies planned local files with explicit approval', () => {
    const repo = tempRepo()
    writeConsumerPackageJson(repo)

    const result = runGuardrails(['apply', '--cwd', repo, '--yes', '--json'])
    const payload = parseJson<{ applied: Array<{ path: string }>; conflicts: string[] }>(
      result.stdout
    )

    expect(result.status).toBe(0)
    expect(payload.conflicts).toEqual([])
    expect(payload.applied.map((entry) => entry.path)).toContain('package.json')
    expect(existsSync(path.join(repo, 'AGENTS.md'))).toBe(true)
    expect(existsSync(path.join(repo, 'lefthook.yml'))).toBe(true)
    expect(existsSync(path.join(repo, '.guardrails/manifest.json'))).toBe(true)
  })

  it('reports doctor status before and after apply', () => {
    const repo = tempRepo()
    writeConsumerPackageJson(repo)

    const before = runGuardrails(['doctor', `--cwd=${repo}`, '--json'])
    const beforeReport = parseJson<{ ok: boolean; pending: number }>(before.stdout)

    expect(before.status).toBe(1)
    expect(beforeReport.ok).toBe(false)
    expect(beforeReport.pending).toBeGreaterThan(0)

    expect(runGuardrails(['apply', '--cwd', repo, '--yes', '--json']).status).toBe(0)

    const after = runGuardrails(['doctor', `--cwd=${repo}`, '--json'])
    const afterReport = parseJson<{ ok: boolean; pending: number }>(after.stdout)

    expect(after.status).toBe(0)
    expect(afterReport).toMatchObject({ ok: true, pending: 0 })
  })
})

describe('tracker footer patterns', () => {
  it('matches bundled tracker reference shapes', () => {
    expect(trackerFooterPattern('linear').test('Completes AGT-123')).toBe(true)
    expect(trackerFooterPattern('github').test('Fixes #123')).toBe(true)
    expect(trackerFooterPattern('jira').test('Resolves ENG-123')).toBe(true)
    expect(trackerFooterPattern('azure-boards').test('Completes AB#123')).toBe(true)
  })

  it('does not accept multiple references in a single footer line', () => {
    expect(trackerFooterPattern('linear').test('Completes AGT-123, AGT-124')).toBe(false)
  })
})

function tempRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardrails-test-'))
  tempDirs.push(dir)
  return dir
}

function writeConsumerPackageJson(repo: string): void {
  writeJson(path.join(repo, 'package.json'), {
    name: 'demo',
    version: '0.1.0',
    private: true,
    packageManager: 'pnpm@11.5.0',
  })
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
  expect(readFileSync(filePath, 'utf8')).toContain('\n')
}

function readJson<T>(filePath: string): T {
  return parseJson<T>(readFileSync(filePath, 'utf8'))
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T
}

function runGuardrails(args: string[]): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync(
    path.join(process.cwd(), 'node_modules/.bin/tsx'),
    [path.join(process.cwd(), 'src/cli.ts'), ...args],
    { encoding: 'utf8' }
  )

  if (result.error) throw result.error

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
