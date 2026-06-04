import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { PackageJson, RepoInspection } from './types.js'

export function inspectRepo(cwd: string): RepoInspection {
  const packageJson = readPackageJson(cwd)
  const packageManager = packageJson?.packageManager ?? null
  const pnpmVersion = packageManager?.startsWith('pnpm@')
    ? packageManager.replace(/^pnpm@/u, '')
    : null

  return {
    cwd,
    dirname: path.basename(cwd),
    hasPackageJson: packageJson !== null,
    packageJson,
    packageManager,
    nodeVersion: readOptionalFile(cwd, '.nvmrc')?.replace(/^v/u, '').trim() ?? null,
    pnpmVersion,
    hasTurbo: existsSync(path.join(cwd, 'turbo.json')),
    hasPnpmWorkspace: existsSync(path.join(cwd, 'pnpm-workspace.yaml')),
    hasGitHub: existsSync(path.join(cwd, '.github')),
    existingTools: {
      biome: existsSync(path.join(cwd, 'biome.json')) || existsSync(path.join(cwd, 'biome.jsonc')),
      eslint:
        existsSync(path.join(cwd, 'eslint.config.js')) ||
        existsSync(path.join(cwd, 'eslint.config.mjs')) ||
        existsSync(path.join(cwd, '.eslintrc')) ||
        existsSync(path.join(cwd, '.eslintrc.json')) ||
        existsSync(path.join(cwd, '.eslintrc.cjs')),
      prettier:
        existsSync(path.join(cwd, '.prettierrc')) ||
        existsSync(path.join(cwd, '.prettierrc.json')) ||
        existsSync(path.join(cwd, 'prettier.config.js')),
      husky: existsSync(path.join(cwd, '.husky')),
      lintStaged:
        Boolean(packageJson?.['lint-staged']) || existsSync(path.join(cwd, '.lintstagedrc')),
      lefthook: existsSync(path.join(cwd, 'lefthook.yml')),
      commitlint:
        existsSync(path.join(cwd, 'commitlint.config.cjs')) ||
        existsSync(path.join(cwd, 'commitlint.config.js')) ||
        existsSync(path.join(cwd, 'commitlint.config.mjs')),
    },
  }
}

function readPackageJson(cwd: string): PackageJson | null {
  const packagePath = path.join(cwd, 'package.json')
  if (!existsSync(packagePath)) return null
  return JSON.parse(readFileSync(packagePath, 'utf8')) as PackageJson
}

function readOptionalFile(cwd: string, relativePath: string): string | null {
  const filePath = path.join(cwd, relativePath)
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf8')
}
