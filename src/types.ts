export type TrackerProvider = 'linear' | 'github' | 'jira' | 'azure-boards'

export interface TrackerConfig {
  provider: TrackerProvider
  keyPattern: string
  defaultFooterVerb: string
}

export interface RuntimeConfig {
  node: string
  pnpm: string
}

export interface AgentsConfig {
  enabled: boolean
  symlinks: boolean
  safetyHooks: boolean
}

export interface GithubConfig {
  checksWorkflow: boolean
  ruleset: {
    enabled: boolean
    apply: boolean
  }
}

export interface QualityConfig {
  strictHooks: boolean
}

export interface SmellConfig {
  enabled: boolean
}

export interface GuardrailsConfig {
  $schema?: string
  version: 1
  packageName: '@wiseiodev/guardrails'
  runtime: RuntimeConfig
  tracker: TrackerConfig
  agents: AgentsConfig
  github: GithubConfig
  quality: QualityConfig
  smell: SmellConfig
}

export interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  type?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string
  engines?: Record<string, string>
  [key: string]: unknown
}

export interface RepoInspection {
  cwd: string
  dirname: string
  hasPackageJson: boolean
  packageJson: PackageJson | null
  packageManager: string | null
  nodeVersion: string | null
  pnpmVersion: string | null
  hasTurbo: boolean
  hasPnpmWorkspace: boolean
  hasGitHub: boolean
  existingTools: {
    biome: boolean
    eslint: boolean
    prettier: boolean
    husky: boolean
    lintStaged: boolean
    lefthook: boolean
    commitlint: boolean
  }
}

export type PlannedAction = 'create' | 'update' | 'skip' | 'conflict'

export interface PlannedFile {
  kind: 'file'
  path: string
  action: PlannedAction
  reason: string
  managed: boolean
  content: string
}

export interface PlannedSymlink {
  kind: 'symlink'
  path: string
  action: PlannedAction
  reason: string
  target: string
}

export interface PlannedPackageJson {
  kind: 'package-json'
  path: 'package.json'
  action: PlannedAction
  reason: string
  content: PackageJson
  conflicts: string[]
}

export interface PlannedRemoteAction {
  kind: 'github-ruleset'
  action: 'propose' | 'skip'
  reason: string
  settings: Record<string, unknown>
}

export type LocalChange = PlannedFile | PlannedSymlink | PlannedPackageJson

export interface GuardrailsPlan {
  schemaVersion: 1
  cwd: string
  packageVersion: string
  config: GuardrailsConfig
  inspection: RepoInspection
  localChanges: LocalChange[]
  remoteActions: PlannedRemoteAction[]
  warnings: string[]
  conflicts: string[]
}

export interface ApplyResult {
  cwd: string
  applied: Array<{ path: string; action: string }>
  skipped: Array<{ path: string; reason: string }>
  conflicts: string[]
}
