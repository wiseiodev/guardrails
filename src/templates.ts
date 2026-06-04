import {
  MANAGED_END,
  MANAGED_START,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  TOOL_VERSIONS,
} from './constants.js'
import type { GuardrailsConfig, PackageJson, RepoInspection } from './types.js'

export function biomeTemplate(inspection: RepoInspection): string {
  const domains = hasReactOrNext(inspection.packageJson)
    ? `,
    "domains": {
      "next": "recommended",
      "react": "recommended"
    }`
    : ''

  return `{
  "$schema": "https://biomejs.dev/schemas/${TOOL_VERSIONS.biome}/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "files": {
    "ignoreUnknown": true,
    "includes": [
      "**",
      "!**/node_modules",
      "!**/.next",
      "!**/.turbo",
      "!**/.guardrails",
      "!**/coverage",
      "!**/dist",
      "!**/next-env.d.ts",
      "!**/storybook-static",
      "!pnpm-lock.yaml"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": {
          "level": "error",
          "fix": "safe"
        }
      },
      "style": {
        "noNonNullAssertion": {
          "level": "error",
          "fix": "safe"
        },
        "useNodejsImportProtocol": {
          "level": "error",
          "fix": "safe"
        }
      },
      "suspicious": {
        "noExplicitAny": "error"
      }
    }${domains}
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "jsxQuoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "es5"
    }
  },
  "json": {
    "formatter": {
      "trailingCommas": "none"
    }
  },
  "css": {
    "linter": {
      "enabled": false
    },
    "parser": {
      "tailwindDirectives": true
    },
    "formatter": {
      "quoteStyle": "single"
    }
  }
}
`
}

export function lefthookTemplate(): string {
  return `pre-commit:
  commands:
    biome:
      run: pnpm lint:fix:staged {staged_files}
      stage_fixed: true

commit-msg:
  commands:
    commitlint:
      run: pnpm commitlint:edit {1}

pre-push:
  commands:
    checks:
      # The {all_files} token keeps \`lefthook run pre-push\` from skipping local verification.
      run: "pnpm checks # {all_files}"
`
}

export function commitlintTemplate(config: GuardrailsConfig): string {
  const keyPattern = config.tracker.keyPattern.replace(/\\/g, '\\\\').replace(/`/g, '\\`')

  return `const trackerFooterLinePattern =
  /^(?:[Cc]lose|[Cc]loses|[Cc]losed|[Cc]losing|[Ff]ix|[Ff]ixes|[Ff]ixed|[Ff]ixing|[Rr]esolve|[Rr]esolves|[Rr]esolved|[Rr]esolving|[Cc]omplete|[Cc]ompletes|[Cc]ompleted|[Cc]ompleting|[Ii]mplements|[Ii]mplemented|[Ii]mplementing|[Rr]ef|[Rr]efs|[Rr]eferences|[Pp]art of|[Rr]elated to|[Cc]ontributes to)\\s+(?:${keyPattern})$/
const conventionalTrailerPattern = /^(?:BREAKING[ -]CHANGE|[A-Za-z][A-Za-z-]*)(?: #\\d+)?: .+$/

module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'guardrails-tracker-footer': (parsed) => [
          hasTrackerFooter(parsed.raw ?? ''),
          'commit footer must include exactly one ${config.tracker.provider} work-item line like "${config.tracker.defaultFooterVerb} <key>"',
        ],
      },
    },
  ],
  rules: {
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    'guardrails-tracker-footer': [2, 'always'],
    'header-max-length': [2, 'always', 100],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
  },
}

function hasTrackerFooter(raw) {
  const normalized = raw.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n')
  const matchingTrackerLines = normalized
    .split('\\n')
    .map((line) => line.trim())
    .filter((line) => trackerFooterLinePattern.test(line))
  const footerBlock =
    normalized
      .trim()
      .split(/\\n{2,}/)
      .at(-1) ?? ''
  const lines = footerBlock.split('\\n').filter((line) => line.trim().length > 0)
  let hasTrackerLine = false
  let previousLineAllowsContinuation = false

  const hasOnlyValidFooterLines = lines.every((line) => {
    if (/^[\\t ]+/.test(line)) {
      return previousLineAllowsContinuation
    }

    const trimmedLine = line.trim()
    if (trackerFooterLinePattern.test(trimmedLine)) {
      hasTrackerLine = true
      previousLineAllowsContinuation = false
      return true
    }

    if (conventionalTrailerPattern.test(trimmedLine)) {
      previousLineAllowsContinuation = true
      return true
    }

    previousLineAllowsContinuation = false
    return false
  })

  return hasTrackerLine && hasOnlyValidFooterLines && matchingTrackerLines.length === 1
}
`
}

export function checksWorkflowTemplate(inspection: RepoInspection): string {
  const gates = ['lint', 'typecheck', 'test', 'build'].filter((script) =>
    hasScript(inspection.packageJson, script)
  )
  const steps = gates
    .map((script) => `      - name: ${script}\n        run: pnpm ${script}`)
    .join('\n\n')

  return `name: checks

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: checks-\${{ github.workflow }}-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    runs-on: ubuntu-latest

    steps:
      - name: checkout-repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0

      - name: install-pnpm
        uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8
        with:
          package_json_file: package.json

      - name: setup-node
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: verify-pnpm-version
        run: |
          expected="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
          actual="$(pnpm --version)"
          test "$actual" = "$expected"

      - name: install-dependencies
        run: pnpm install --frozen-lockfile

${steps || '      - name: checks\n        run: pnpm checks'}
`
}

export function pullRequestTemplate(config: GuardrailsConfig): string {
  return `## What changed


## Why


## What I checked

- [ ] \`pnpm checks\`

## Work item

${config.tracker.defaultFooterVerb} <${exampleTrackerKey(config)}>
`
}

export function agentsTemplate(config: GuardrailsConfig): string {
  return `${MANAGED_START}
# Guardrails

This repo uses ${PACKAGE_NAME} for core hygiene.

- Package manager: pnpm.
- Local proof line: \`pnpm checks\`.
- Formatting and linting: Biome.
- Git hooks: Lefthook runs staged Biome fixes, commitlint, and pre-push checks.
- Commits must be conventional and include exactly one ${config.tracker.provider} work-item footer, for example:

\`\`\`text
feat(scope): describe the change

${config.tracker.defaultFooterVerb} ${exampleTrackerKey(config)}
\`\`\`

Do not bypass hooks with \`--no-verify\`.
${MANAGED_END}
`
}

export function manifestTemplate(planHash: string): string {
  return `${JSON.stringify(
    {
      version: 1,
      packageName: PACKAGE_NAME,
      packageVersion: PACKAGE_VERSION,
      planHash,
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  )}\n`
}

export function safetyHookTemplate(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

input="$(cat || true)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // .command // empty' 2>/dev/null || true)"

if [ -z "$command" ]; then
  command="$input"
fi

patterns=(
  '(^|[[:space:]])git[[:space:]]+reset[[:space:]].*--hard'
  '(^|[[:space:]])git[[:space:]]+clean[[:space:]].*-[^[:space:]]*[fdx]'
  '(^|[[:space:]])git[[:space:]]+push[[:space:]].*(--force|-f)([[:space:]]|$)'
  '(^|[[:space:]])git[[:space:]]+commit[[:space:]].*--no-verify'
  '(^|[[:space:]])git[[:space:]]+push[[:space:]].*--no-verify'
  '(^|[[:space:]])rm[[:space:]]+-rf[[:space:]]+/'
)

for pattern in "\${patterns[@]}"; do
  if echo "$command" | grep -qiE "$pattern"; then
    echo "guardrails: blocked destructive command" >&2
    echo "$command" >&2
    exit 2
  fi
done
`
}

export function mergeManagedBlock(existing: string | null, block: string): string {
  if (!existing) return block

  const start = existing.indexOf(MANAGED_START)
  const end = existing.indexOf(MANAGED_END)
  if (start >= 0 && end > start) {
    const before = existing.slice(0, start).trimEnd()
    const after = existing.slice(end + MANAGED_END.length).trimStart()
    const pieces = [before, block.trim(), after].filter(Boolean)
    return `${pieces.join('\n\n')}\n`
  }

  return `${existing.trimEnd()}\n\n${block.trim()}\n`
}

export function managedPackageJson(
  inspection: RepoInspection,
  config: GuardrailsConfig
): { content: PackageJson; conflicts: string[] } {
  const existing = inspection.packageJson ?? {}
  const scripts = { ...(existing.scripts ?? {}) }
  const conflicts: string[] = []
  const desiredScripts = desiredScriptMap(inspection)

  for (const [name, value] of Object.entries(desiredScripts)) {
    if (scripts[name] && scripts[name] !== value) {
      conflicts.push(`package.json scripts.${name} already exists with a different value`)
      continue
    }
    scripts[name] = value
  }

  const devDependencies = { ...(existing.devDependencies ?? {}) }
  const desiredDevDeps = {
    [PACKAGE_NAME]: PACKAGE_VERSION,
    '@biomejs/biome': TOOL_VERSIONS.biome,
    '@commitlint/cli': TOOL_VERSIONS.commitlintCli,
    '@commitlint/config-conventional': TOOL_VERSIONS.commitlintConfigConventional,
    lefthook: TOOL_VERSIONS.lefthook,
  }

  for (const [name, version] of Object.entries(desiredDevDeps)) {
    devDependencies[name] = version
  }

  const content: PackageJson = {
    name: existing.name ?? inspection.dirname,
    version: existing.version ?? '0.1.0',
    private: existing.private ?? true,
    ...existing,
    scripts,
    devDependencies,
    packageManager: `pnpm@${config.runtime.pnpm}`,
    engines: {
      ...(existing.engines ?? {}),
      node: config.runtime.node,
      pnpm: config.runtime.pnpm,
    },
  }

  return { content, conflicts }
}

export function desiredScriptMap(inspection: RepoInspection): Record<string, string> {
  const scripts: Record<string, string> = {
    'commitlint:edit': 'commitlint --edit',
    format: 'biome format --write .',
    lint: 'biome check .',
    'lint:fix': 'biome check --write .',
    'lint:fix:staged':
      'biome check --write --no-errors-on-unmatched --files-ignore-unknown=true --colors=off',
    prepare: 'lefthook install',
  }

  const existingScripts = inspection.packageJson?.scripts ?? {}
  const gates = ['lint', 'typecheck', 'test', 'build'].filter(
    (script) => script === 'lint' || Boolean(existingScripts[script])
  )
  scripts.checks = gates.map((script) => `pnpm ${script}`).join(' && ')

  return scripts
}

function hasScript(packageJson: PackageJson | null, script: string): boolean {
  return Boolean(packageJson?.scripts?.[script]) || script === 'lint'
}

function hasReactOrNext(packageJson: PackageJson | null): boolean {
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  }

  return Boolean(deps.react || deps.next)
}

function exampleTrackerKey(config: GuardrailsConfig): string {
  switch (config.tracker.provider) {
    case 'azure-boards':
      return 'AB#123'
    case 'github':
      return '#123'
    case 'jira':
      return 'PROJ-123'
    case 'linear':
      return 'ABC-123'
  }
}
