#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { applyPlan } from './apply.js'
import { CONFIG_FILE, defaultConfig, loadConfig, serializeConfig } from './config.js'
import { doctorReport } from './doctor.js'
import { inspectRepo } from './inspect.js'
import { createPlan } from './planner.js'

interface CliOptions {
  command: string
  cwd: string
  json: boolean
  yes: boolean
  help: boolean
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || options.command === 'help') {
    printHelp()
    return
  }

  const cwd = path.resolve(options.cwd)
  const inspection = inspectRepo(cwd)

  switch (options.command) {
    case 'init':
      runInit(cwd, inspection, options)
      return
    case 'plan':
      runPlan(cwd, inspection, options)
      return
    case 'apply':
      runApply(cwd, inspection, options)
      return
    case 'doctor':
      runDoctor(cwd, inspection, options)
      return
    default:
      console.error(`Unknown command "${options.command}".`)
      printHelp()
      process.exitCode = 1
  }
}

function runInit(
  cwd: string,
  inspection: ReturnType<typeof inspectRepo>,
  options: CliOptions
): void {
  const configPath = path.join(cwd, CONFIG_FILE)
  const created = !existsSync(configPath)
  if (created) {
    mkdirSync(path.dirname(configPath), { recursive: true })
    writeFileSync(configPath, serializeConfig(defaultConfig(inspection)))
  }

  const payload = {
    command: 'init',
    cwd,
    configPath: CONFIG_FILE,
    created,
    next: ['guardrails plan --json', 'guardrails apply --yes'],
  }
  printPayload(payload, options.json)
}

function runPlan(
  cwd: string,
  inspection: ReturnType<typeof inspectRepo>,
  options: CliOptions
): void {
  const config = loadConfig(cwd, inspection)
  const plan = createPlan(inspection, config)
  printPayload(plan, options.json)
}

function runApply(
  cwd: string,
  inspection: ReturnType<typeof inspectRepo>,
  options: CliOptions
): void {
  if (!options.yes) {
    console.error('Refusing to apply without --yes. Run `guardrails plan --json` first.')
    process.exitCode = 2
    return
  }

  const config = loadConfig(cwd, inspection)
  const plan = createPlan(inspection, config)
  const result = applyPlan(plan)
  printPayload(result, options.json)
  if (result.conflicts.length > 0) process.exitCode = 2
}

function runDoctor(
  cwd: string,
  inspection: ReturnType<typeof inspectRepo>,
  options: CliOptions
): void {
  const config = loadConfig(cwd, inspection)
  const plan = createPlan(inspection, config)
  const report = doctorReport(plan)
  printPayload(report, options.json)
  if (!report.ok) process.exitCode = 1
}

function parseArgs(args: string[]): CliOptions {
  let command = 'help'
  let cwd = process.cwd()
  let json = false
  let yes = false
  let help = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--yes') {
      yes = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--cwd') {
      const value = args[i + 1]
      if (!value) throw new Error('--cwd expects a path')
      cwd = value
      i += 1
      continue
    }
    if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length)
      continue
    }
    if (command === 'help') {
      command = arg
    }
  }

  return { command, cwd, json, yes, help }
}

function printPayload(payload: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  if (isDoctorPayload(payload)) {
    console.log(payload.ok ? 'guardrails: ok' : 'guardrails: attention needed')
    console.log(`current: ${payload.current}`)
    console.log(`pending: ${payload.pending}`)
    if (payload.conflicts.length > 0) console.log(`conflicts: ${payload.conflicts.length}`)
    return
  }

  console.log(JSON.stringify(payload, null, 2))
}

function isDoctorPayload(payload: unknown): payload is ReturnType<typeof doctorReport> {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      'ok' in payload &&
      'current' in payload &&
      'pending' in payload
  )
}

function printHelp(): void {
  console.log(`guardrails

Usage:
  guardrails init [--cwd <path>] [--json]
  guardrails plan [--cwd <path>] [--json]
  guardrails apply --yes [--cwd <path>] [--json]
  guardrails doctor [--cwd <path>] [--json]
`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
