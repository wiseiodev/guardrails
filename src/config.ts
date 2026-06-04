import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_NAME } from './constants.js'
import type { GuardrailsConfig, RepoInspection, TrackerProvider } from './types.js'

export const CONFIG_FILE = 'guardrails.config.jsonc'

export function defaultConfig(inspection: RepoInspection): GuardrailsConfig {
  return {
    version: 1,
    packageName: PACKAGE_NAME,
    runtime: {
      node: inspection.nodeVersion ?? process.version.replace(/^v/u, ''),
      pnpm: inspection.pnpmVersion ?? '11.5.0',
    },
    tracker: defaultTrackerConfig('linear'),
    agents: {
      enabled: true,
      symlinks: true,
      safetyHooks: false,
    },
    github: {
      checksWorkflow: true,
      ruleset: {
        enabled: true,
        apply: false,
      },
    },
    quality: {
      strictHooks: true,
    },
    smell: {
      enabled: false,
    },
  }
}

export function defaultTrackerConfig(provider: TrackerProvider): GuardrailsConfig['tracker'] {
  switch (provider) {
    case 'github':
      return {
        provider,
        keyPattern: '(?:#\\d+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#\\d+)',
        defaultFooterVerb: 'Completes',
      }
    case 'jira':
      return {
        provider,
        keyPattern: '[A-Z][A-Z0-9]+-\\d+',
        defaultFooterVerb: 'Completes',
      }
    case 'azure-boards':
      return {
        provider,
        keyPattern: 'AB#\\d+',
        defaultFooterVerb: 'Completes',
      }
    case 'linear':
      return {
        provider,
        keyPattern: '[A-Z][A-Z0-9]+-\\d+',
        defaultFooterVerb: 'Completes',
      }
  }
}

export function loadConfig(cwd: string, inspection: RepoInspection): GuardrailsConfig {
  const configPath = path.join(cwd, CONFIG_FILE)
  if (!existsSync(configPath)) return defaultConfig(inspection)

  const parsed = parseJsonc(readFileSync(configPath, 'utf8')) as Partial<GuardrailsConfig>
  const defaults = defaultConfig(inspection)
  const trackerProvider = parsed.tracker?.provider ?? defaults.tracker.provider

  return {
    ...defaults,
    ...parsed,
    version: 1,
    packageName: PACKAGE_NAME,
    runtime: {
      ...defaults.runtime,
      ...(parsed.runtime ?? {}),
    },
    tracker: {
      ...defaultTrackerConfig(trackerProvider),
      ...(parsed.tracker ?? {}),
    },
    agents: {
      ...defaults.agents,
      ...(parsed.agents ?? {}),
    },
    github: {
      ...defaults.github,
      ...(parsed.github ?? {}),
      ruleset: {
        ...defaults.github.ruleset,
        ...(parsed.github?.ruleset ?? {}),
      },
    },
    quality: {
      ...defaults.quality,
      ...(parsed.quality ?? {}),
    },
    smell: {
      ...defaults.smell,
      ...(parsed.smell ?? {}),
    },
  }
}

export function serializeConfig(config: GuardrailsConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonComments(text))
}

function stripJsonComments(text: string): string {
  let output = ''
  let inString = false
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const current = text[i]
    const next = text[i + 1]

    if (inString) {
      output += current
      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === quote) {
        inString = false
        quote = null
      }
      continue
    }

    if (current === '"' || current === "'") {
      inString = true
      quote = current
      output += current
      continue
    }

    if (current === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      output += '\n'
      continue
    }

    if (current === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }

    output += current
  }

  return output
}
