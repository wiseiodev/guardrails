import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPlan } from '../src/apply.js'
import { trackerFooterPattern } from '../src/commitlint.js'
import { CONFIG_FILE, defaultConfig, loadConfig } from '../src/config.js'
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

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
  expect(readFileSync(filePath, 'utf8')).toContain('\n')
}
