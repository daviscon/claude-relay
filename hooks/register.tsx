import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Account, Job, Live } from '../types'

// The relay panel: every account's usage beside the chat, a one-click
// hand-off of this chat to another account when this one runs out, and side
// tasks that run as forks of this chat on another account. The accounts and
// the hand-off itself are the `relay` CLI shipped in this plugin's folder.

const PANE = 'relay'
const DOCKED = 'Relay panel opened'
// Auto-delegate outlives the session: it is a standing choice.
const AUTO_KEY = 'autoDelegate'
const MINUTE = 60_000

const accounts = atom({ plugin: 'relay', key: 'accounts' } as const, [])
const live = atom({ plugin: 'relay', key: 'live' } as const, null)
const jobs = atom({ plugin: 'relay', key: 'jobs' } as const, [])
const panel = atom({ plugin: 'relay', key: 'panel' } as const, {
  checkedAt: null,
  isChecking: false,
  message: null,
  outAt: null,
  handedTo: null,
  isAuto: false,
})

type $ = EngineInterface

const bin = ($: $) => `${$.plugin.root}/relay`

// CLAUDECODE tells relay it runs under Claude Code, so it keeps this
// session's own variables away from the accounts it checks.
const relay = ($: $, args: string[], timeoutMs = 120_000) =>
  $.process.run([bin($), ...args], { env: { CLAUDECODE: '1' }, timeoutMs })

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const appleString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

type Window = { used?: number; resets?: number; status?: string } | undefined
type Reading = {
  ok?: boolean
  status?: string
  error?: string
  five_hour?: Window
  seven_day?: Window
}

const percent = (w: Window) => (typeof w?.used === 'number' ? Math.round(w.used * 100) : null)

function parseStatus(stdout: string): Account[] {
  const all = JSON.parse(stdout) as Record<string, Reading | null>
  return Object.entries(all).map(([name, st]) => ({
    name,
    five: percent(st?.five_hour),
    week: percent(st?.seven_day),
    fiveResets: st?.five_hour?.resets ?? null,
    weekResets: st?.seven_day?.resets ?? null,
    isBlocked:
      st?.status === 'rejected' ||
      st?.five_hour?.status === 'rejected' ||
      st?.seven_day?.status === 'rejected',
    error: st?.ok ? null : (st?.error ?? 'unreachable'),
  }))
}

const headroom = (a: Account) =>
  a.isBlocked || a.error ? -1 : 100 - Math.max(a.five ?? 0, a.week ?? 0)

/** The account this chat runs on: the one whose windows reset when this chat's do. */
function thisChat(list: Account[], now: Live | null): string | null {
  if (!now || (now.fiveResets === null && now.weekResets === null)) return null
  const near = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) < 120
  const hit = list.find(
    a => !a.error && near(a.fiveResets, now.fiveResets) && near(a.weekResets, now.weekResets),
  )
  return hit?.name ?? null
}

function nextUp(list: Account[], here: string | null): string | null {
  const best = list
    .filter(a => a.name !== here && headroom(a) > 2)
    .sort((a, b) => headroom(b) - headroom(a))[0]
  return best?.name ?? null
}

/** This chat's account, with the live figures in place of relay's cached ones. */
function merged(list: Account[], now: Live | null, here: string | null): Account[] {
  return list.map(a =>
    a.name === here && now
      ? { ...a, five: now.five ?? a.five, week: now.week ?? a.week }
      : a,
  )
}

function until(ts: number | null, nowMs: number) {
  if (!ts) return ''
  const s = Math.round(ts - nowMs / 1000)
  if (s <= 0) return 'now'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`
}

function ago(ms: number | null, nowMs: number) {
  if (!ms) return 'not checked yet'
  const m = Math.floor((nowMs - ms) / MINUTE)
  return m < 1 ? 'checked just now' : `checked ${m}m ago`
}

const bar = (p: number | null, width: number) => {
  const full = Math.round((Math.max(0, Math.min(100, p ?? 0)) / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

const pad = (p: number | null) => (p === null ? '  —' : `${p}%`.padStart(4))

async function refresh($: $, force = false) {
  const state = await read($, panel)
  if (state.isChecking) return
  await update($, panel, p => ({ ...p, isChecking: true }))
  try {
    const run = await relay($, ['status', '--json', ...(force ? ['--refresh'] : [])])
    if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `relay exited ${run.exitCode}`)
    const list = parseStatus(run.stdout)
    const at = await $.clock.now()
    await update($, accounts, () => list)
    await update($, panel, p => ({
      ...p,
      isChecking: false,
      checkedAt: at,
      message: list.length ? null : 'No accounts yet. In a terminal: relay add <name>',
    }))
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    await update($, panel, p => ({ ...p, isChecking: false, message: `Couldn't run relay: ${text.slice(0, 200)}` }))
  }
}

/** Runs `cmd` in a new Terminal window; false where none could be opened. */
async function inTerminal($: $, cmd: string): Promise<boolean> {
  const opened = await $.process
    .run([
      'osascript',
      '-e', `tell application "Terminal" to do script ${appleString(cmd)}`,
      '-e', 'tell application "Terminal" to activate',
    ])
    .catch(() => null)
  return Boolean(opened && opened.exitCode === 0)
}

/** Reopens this exact chat in Terminal, billed to `name`. */
async function continueOn($: $, name: string, surface?: string): Promise<string> {
  const sid = await $.session.id()
  const cwd = await $.session.cwd()
  const cmd = `cd ${sh(cwd)} && ${sh(bin($))} resume ${sid} --as ${sh(name)}`
  await update($, panel, p => ({ ...p, handedTo: name }))
  if (await inTerminal($, cmd)) {
    return `This chat now continues in Terminal on "${name}". Type there from here on, not in this window.`
  }
  await $.ui.copy({ text: cmd, ...(surface ? { surface: surface as never } : {}) })
  return `Couldn't open Terminal, so the command is on your clipboard. Paste it into a terminal to continue this chat on "${name}".`
}

type Report = { ok: boolean; result: string; account: string; seconds: number; session_id: string | null }

/** Runs one task as a fork of chat `fork` (fresh where null) on `target`; settles with the finished job. */
async function runJob($: $, job: Job, target: string | null, fork: string | null): Promise<Job> {
  const args = ['delegate', '--json', ...(fork ? ['--fork', fork] : ['--fresh']), ...(target ? ['--as', target] : []), job.task]
  let out = ''
  let err = ''
  try {
    for await (const chunk of $.process.spawn({ argv: [bin($), ...args], env: { CLAUDECODE: '1' } })) {
      if (chunk.stream === 'stdout') out += chunk.text
      else err += chunk.text
    }
  } catch (e) {
    err += e instanceof Error ? e.message : String(e)
  }
  let done: Partial<Job> = { state: 'failed', result: (err.trim() || 'The worker stopped without a report.').slice(-600) }
  try {
    const [r] = JSON.parse(out.slice(out.indexOf('['))) as Report[]
    if (r) done = { state: r.ok ? 'done' : 'failed', result: r.result, account: r.account, seconds: r.seconds, sessionId: r.session_id }
  } catch {
    // no JSON: keep the failure built from stderr
  }
  const finished: Job = { ...job, ...done }
  await update($, jobs, js => js.map(j => (j.id === job.id ? finished : j)))
  void refresh($)
  return finished
}

/** Where each task goes: the named account, else spread over the accounts with most room, this chat's own last. */
function placeTasks(list: Account[], here: string | null, count: number, account?: string): (string | null)[] {
  if (account) return Array.from({ length: count }, () => account)
  const order = list
    .filter(a => a.name !== here && headroom(a) > 2)
    .sort((a, b) => headroom(b) - headroom(a))
    .map(a => a.name)
  return Array.from({ length: count }, (_, i) => order[i % order.length] ?? null)
}

/** Starts each task on its account; `done` settles once every one has finished. */
async function startJobs($: $, tasks: string[], account?: string, fresh = false) {
  const list = await read($, accounts)
  const here = thisChat(list, await read($, live))
  const targets = placeTasks(list, here, tasks.length, account)
  const fork = fresh ? null : await $.session.id()
  const base = await $.clock.now()
  const started: Job[] = tasks.map((task, i) => ({
    id: `${base}-${i}`, task, account: targets[i] ?? 'best account', state: 'running', result: null, seconds: null, sessionId: null,
  }))
  await update($, jobs, js => [...started, ...js].slice(0, 8))
  const done = Promise.all(started.map((job, i) => runJob($, job, targets[i] ?? null, fork)))
  return { started, done }
}

/** A finished job told to the person, and to the model the way a subagent's result comes back. */
async function reportBack($: $, j: Job) {
  $.ui.toast(j.state === 'done' ? `Side task done on ${j.account}` : `Side task on ${j.account} failed`)
  await $.session.append({
    message: {
      type: 'user',
      content: [{
        type: 'text',
        text: `[relay] A copy of this chat on account "${j.account}" ${j.state === 'done' ? 'finished' : 'failed'} the side task "${j.task}". Its report:\n\n${j.result}`
          + (j.sessionId ? `\n\n(Its own chat continues with: relay resume ${j.sessionId})` : ''),
      }],
    },
  }).catch(() => undefined)
}

/** Starts tasks now and reports each back into the chat as it finishes. */
async function startInBackground($: $, tasks: string[], account?: string, fresh = false): Promise<Job[]> {
  const { started, done } = await startJobs($, tasks, account, fresh)
  void (async () => {
    for (const j of await done) await reportBack($, j)
  })()
  return started
}

/** The panel's and /relay-delegate's one task. */
async function startJob($: $, task: string): Promise<string> {
  const [job] = await startInBackground($, [task])
  return job && job.account !== 'best account'
    ? `Sent to "${job.account}". A copy of this chat is working on it there and will report back here.`
    : 'Sent to the account with the most usage left. A copy of this chat will report back here.'
}

function formatReports(done: Job[]): string {
  return done
    .map(j =>
      `## ${j.task}\nAccount: ${j.account} · ${j.state}${j.seconds !== null ? ` · ${j.seconds}s` : ''}\n\n${j.result ?? ''}`
      + (j.sessionId ? `\n\n(That copy's own chat: relay resume ${j.sessionId})` : ''),
    )
    .join('\n\n')
}

const DELEGATE_TOOL = {
  name: 'delegate',
  description:
    "Run work on the user's OTHER Claude accounts through relay, so it doesn't use this account's usage. "
    + 'Each task runs as a copy of this whole conversation (it already knows everything said here) on another account, in parallel. '
    + 'Use it when the user says to delegate or send work to another account ("delegate this to work", "use my other account", '
    + '"split these across my accounts"), or for several big independent jobs at once. Call mcp__relay__accounts first if you need the account names. '
    + 'Each task must say exactly what to produce and where to save it (full paths); never give two tasks the same file; no task may wait on another. '
    + 'wait=true (default) waits for the reports and returns them, which can take minutes; wait=false returns at once and each report arrives in the conversation when done. '
    + 'Not for small steps you can do in a few tool calls: a copy re-reads the whole chat.',
  inputSchema: {
    type: 'object',
    properties: {
      tasks: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6, description: 'One self-contained task per worker.' },
      account: { type: 'string', description: 'Put every task on this account. Left out, tasks spread over the accounts with the most usage left.' },
      wait: { type: 'boolean', description: 'Wait for the reports (default true).' },
      fresh: { type: 'boolean', description: 'Start the copies with no conversation context (cheaper; the task must stand alone).' },
    },
    required: ['tasks'],
  },
  isDeferred: false,
} as const

const ACCOUNTS_TOOL = {
  name: 'accounts',
  description: "Usage left on each of the user's Claude accounts (relay): 5-hour and weekly, which account this chat runs on, and which goes next.",
  inputSchema: { type: 'object', properties: {} },
  isDeferred: false,
} as const

async function setAuto($: $, isAuto: boolean) {
  await $.store.set(AUTO_KEY, isAuto)
  await update($, panel, p => ({ ...p, isAuto }))
}

/** The system prompt's nudge while auto-delegate is on and this account runs low. */
function autoSection(list: Account[], now: Live | null): string | null {
  const here = thisChat(list, now)
  const used = Math.max(now?.five ?? 0, now?.week ?? 0)
  const next = nextUp(list, here)
  if (used < 90 || !next) return null
  const which = (now?.five ?? 0) >= (now?.week ?? 0) ? '5-hour' : 'weekly'
  return `This chat's Claude account${here ? ` ("${here}")` : ''} is at ${used}% of its ${which} usage, and the user turned on relay auto-delegate. `
    + `Send large, independent jobs (renders, research, long scripts, batch edits) to their account "${next}" with the mcp__relay__delegate tool instead of doing them here, and say in one line that you did. `
    + 'Keep small steps, and anything the user is waiting to decide, here.'
}

function statusText(list: Account[], now: Live | null, nowMs: number): string {
  if (!list.length) return 'No relay accounts yet. In a terminal: relay add <name>'
  const here = thisChat(list, now)
  const next = nextUp(list, here)
  return merged(list, now, here)
    .map(a => {
      const tags = [a.name === here ? 'this chat' : '', a.name === next ? 'next up' : ''].filter(Boolean).join(', ')
      if (a.error) return `${a.name}: ${a.error}`
      const reset = a.isBlocked ? `, frees up in ${until(Math.min(a.fiveResets ?? Infinity, a.weekResets ?? Infinity), nowMs)}` : ''
      return `${a.name}: 5-hour ${pad(a.five).trim()}, week ${pad(a.week).trim()}${reset}${tags ? `  (${tags})` : ''}`
    })
    .join('\n')
}

// One drawing for both places: docked as a pane, or inline under the
// /relay-panel row where the surface seats no panes.
async function drawPanel($: $, e: Parameters<$['ui']['resolve']>[0], columns: number) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  // The mobile app draws no text field yet.
  const Input = 'Input' in els ? els.Input : null
  const list = await read($, accounts)
  const now = await read($, live)
  const state = await read($, panel)
  const tasks = await read($, jobs)
  const nowMs = await $.clock.now()
  const here = thisChat(list, now)
  const next = nextUp(list, here)
  const rows = merged(list, now, here)
  const hereRow = rows.find(a => a.name === here)
  const isOut = Boolean(state.outAt && !state.handedTo) || Boolean(hereRow && headroom(hereRow) <= 2)
  const width = Math.max(6, Math.min(16, columns - 16))

  return (
    <Box flexDirection="column" gap={1}>
      {state.handedTo ? (
        <Box flexDirection="column">
          <Text weight="semibold">Moved to Terminal on {state.handedTo}</Text>
          <Text dimColor>Keep typing there. This window won't see what happens next.</Text>
        </Box>
      ) : isOut ? (
        <Box flexDirection="column" gap={1}>
          <Text weight="semibold">{here ?? 'This account'} is out of usage</Text>
          {next ? (
            <Button
              key="go-next"
              variant="primary"
              label={`Continue this chat on ${next}`}
              onPress={async press => $.ui.toast(await continueOn($, next, press.surface))}
            />
          ) : (
            <Text dimColor>Every account is out right now.</Text>
          )}
        </Box>
      ) : null}

      {rows.map(a => (
        <Box key={a.name} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text weight="semibold">{a.name}</Text>
            {a.name === here ? <Text dimColor>this chat</Text> : null}
            {a.name === next ? <Text color="suggestion">next up</Text> : null}
          </Box>
          {a.error ? (
            <Text dimColor>{a.error}</Text>
          ) : (
            <Box flexDirection="column">
              <Text mono>{`5h   ${bar(a.five, width)} ${pad(a.five)}`}</Text>
              <Text mono>{`week ${bar(a.week, width)} ${pad(a.week)}`}</Text>
              {a.isBlocked ? (
                <Text dimColor>frees up in {until(Math.min(a.fiveResets ?? Infinity, a.weekResets ?? Infinity), nowMs)}</Text>
              ) : null}
            </Box>
          )}
          {a.name !== here && !a.error && !a.isBlocked && !isOut ? (
            <Button
              key={`go-${a.name}`}
              plain
              dimColor
              label={`Continue this chat on ${a.name}`}
              onPress={async press => $.ui.toast(await continueOn($, a.name, press.surface))}
            />
          ) : null}
        </Box>
      ))}

      {list.length ? (
        <Box flexDirection="column" gap={1}>
          <Text weight="semibold">Side task on {next ?? 'another account'}</Text>
          <Text dimColor>A copy of this chat does it there and reports back here.</Text>
          {Input ? (
            <Input
              key="task"
              placeholder="e.g. render hook B to out/hookB.mp4"
              submitLabel="Send"
              onSubmit={async (value: string) => {
                const task = value.trim()
                if (task) $.ui.toast(await startJob($, task))
              }}
            />
          ) : (
            <Text dimColor>Use /relay-delegate &lt;task&gt; to send one.</Text>
          )}
          {tasks.map(j => (
            <Box key={j.id} flexDirection="column">
              <Text>
                {j.state === 'running' ? '… ' : j.state === 'done' ? '✓ ' : '✗ '}
                {j.task}
              </Text>
              <Text dimColor>
                {j.account} · {j.state === 'running' ? 'working' : j.state}
                {j.seconds !== null ? ` · ${j.seconds}s` : ''}
              </Text>
              {j.result && j.state !== 'running' ? (
                <Text dimColor>{j.result.length > 240 ? `${j.result.slice(0, 240)}…` : j.result}</Text>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}

      {list.length > 1 ? (
        <Box flexDirection="column">
          <Button
            key="auto"
            plain
            label={`Auto-delegate near the limit: ${state.isAuto ? 'on' : 'off'}`}
            onPress={() => setAuto($, !state.isAuto)}
          />
          <Text dimColor>
            {state.isAuto
              ? 'Past 90% on this account, Claude sends big independent jobs to the next account by itself.'
              : 'Off: Claude only delegates when you ask ("delegate this to …").'}
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="row" gap={1}>
        <Button
          key="refresh"
          plain
          label={state.isChecking ? 'Checking…' : 'Refresh'}
          onPress={() => refresh($, true)}
        />
        <Text dimColor>{state.message ?? ago(state.checkedAt, nowMs)}</Text>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'relay-panel', description: 'Show usage for all your Claude accounts beside the chat' })
    await $.command.register({ name: 'relay-status', description: 'Usage left on each of your Claude accounts' })
    await $.command.register({
      name: 'relay-swap',
      description: 'Continue this chat in Terminal on another account',
      argumentHint: '[account]',
    })
    await $.command.register({
      name: 'relay-add',
      description: 'Log in another Claude account for relay (opens Terminal)',
      argumentHint: '<name> [--login]',
    })
    await $.command.register({
      name: 'relay-delegate',
      description: 'Run a side task as a copy of this chat on your other account',
      argumentHint: '<task>',
    })
    await $.command.register({
      name: 'relay-auto',
      description: 'Let Claude send big jobs to your other account when this one is nearly out',
      argumentHint: '[on|off]',
    })
    await $.tool.register(DELEGATE_TOOL)
    await $.tool.register(ACCOUNTS_TOOL)
    const isAuto = (await $.store.get(AUTO_KEY)) === true
    await update($, panel, p => ({ ...p, isAuto }))
    void refresh($)
    $.clock.every(10 * MINUTE, () => void refresh($))
    return started
  })

  on('session.measure', async ($, e, next) => {
    const five = e.rateLimits.find(r => r.kind === 'five_hour')
    const week = e.rateLimits.find(r => r.kind === 'seven_day')
    if (five || week) {
      const secs = (iso?: string) => (iso ? Math.round(Date.parse(iso) / 1000) : null)
      await update($, live, () => ({
        five: five ? Math.round(five.percentUsed) : null,
        week: week ? Math.round(week.percentUsed) : null,
        fiveResets: secs(five?.resetsAt),
        weekResets: secs(week?.resetsAt),
      }))
    }
    return next(e)
  })

  // The chat just hit its usage limit: open the panel on the way out.
  on('classic.StopFailure', async ($, e, next) => {
    const ran = await next(e)
    if (e.error === 'rate_limit') {
      const at = await $.clock.now()
      await update($, panel, p => ({ ...p, outAt: at, handedTo: null }))
      void refresh($, true)
      await $.ui.open({ id: PANE, title: 'Relay' })
      $.ui.toast('This account is out of usage. The Relay panel can move this chat to another one.')
      void $.ui.notify('This account is out of usage. Open the Relay panel to carry on with another account.', { title: 'relay' })
    }
    return ran
  })

  on('command.run', { command: 'relay-panel' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Relay' })
    void refresh($)
    return {
      text: opened.isPlaced
        ? `${DOCKED} beside the chat.`
        : `Relay couldn't dock a panel here (${opened.reason}), so here it is in the chat.`,
    }
  })

  on('command.run', { command: 'relay-status' }, async $ => {
    await refresh($, true)
    const state = await read($, panel)
    if (state.message) return { text: state.message }
    return { text: statusText(await read($, accounts), await read($, live), await $.clock.now()) }
  })

  on('command.run', { command: 'relay-swap' }, async ($, e) => {
    const list = await read($, accounts)
    const here = thisChat(list, await read($, live))
    const name = e.args.trim() || nextUp(list, here)
    if (!name) return { text: 'No other account has usage left right now.' }
    if (!list.some(a => a.name === name)) return { text: `No relay account called "${name}". Accounts: ${list.map(a => a.name).join(', ')}` }
    if (name === here) return { text: `This chat is already on "${name}".` }
    return { text: await continueOn($, name) }
  })

  on('command.run', { command: 'relay-add' }, async ($, e) => {
    const [name, flag, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(name) || rest.length || (flag && flag !== '--login')) {
      return {
        text: 'Usage: /relay-add <name> to log in another account in the browser, or /relay-add <name> --login '
          + 'for the account Claude Code in your terminal is already logged into.',
      }
    }
    const cmd = `${sh(bin($))} add ${sh(name)}${flag ? ' --login' : ''}`
    if (await inTerminal($, cmd)) {
      return {
        text: flag
          ? `Adding "${name}" in Terminal. Then run /relay-panel.`
          : `Terminal is logging in "${name}". Sign in to that Claude account in the browser, paste the code back into Terminal, then run /relay-panel.`,
      }
    }
    return { text: `Couldn't open Terminal. Run this in a terminal: ${cmd}` }
  })

  on('command.run', { command: 'relay-auto' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg && arg !== 'on' && arg !== 'off') return { text: 'Usage: /relay-auto [on|off]' }
    const isAuto = arg ? arg === 'on' : !(await read($, panel)).isAuto
    await setAuto($, isAuto)
    return {
      text: isAuto
        ? 'Auto-delegate is on: once this account passes 90%, Claude sends big independent jobs to your account with the most room, and says so.'
        : 'Auto-delegate is off: Claude only delegates when you ask.',
    }
  })

  on('tool.call', { tool: 'mcp__relay__accounts' }, async $ => {
    await refresh($)
    const state = await read($, panel)
    return { result: state.message ?? statusText(await read($, accounts), await read($, live), await $.clock.now()) }
  })

  on('tool.call', { tool: 'mcp__relay__delegate' }, async ($, e) => {
    const input = e as unknown as { tasks?: unknown; account?: unknown; wait?: unknown; fresh?: unknown }
    const tasks = Array.isArray(input.tasks)
      ? input.tasks.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map(t => t.trim())
      : []
    if (!tasks.length || tasks.length > 6) return { deny: 'Give 1 to 6 tasks, each a non-empty string.' }
    if (!(await read($, accounts)).length) await refresh($)
    const list = await read($, accounts)
    const account = typeof input.account === 'string' && input.account.trim() ? input.account.trim() : undefined
    if (account && !list.some(a => a.name === account)) {
      return { deny: `No relay account called "${account}". Accounts: ${list.map(a => a.name).join(', ') || 'none yet'}.` }
    }
    const fresh = input.fresh === true
    if (input.wait === false) {
      const started = await startInBackground($, tasks, account, fresh)
      return {
        result: `Started ${started.length} ${started.length === 1 ? 'copy' : 'copies'} of this chat: `
          + started.map(j => `"${j.task}" on ${j.account}`).join('; ')
          + '. Each report arrives in this conversation when it finishes; carry on meanwhile.',
      }
    }
    const { done } = await startJobs($, tasks, account, fresh)
    const finished = await done
    $.ui.toast(`${finished.filter(j => j.state === 'done').length} of ${finished.length} side tasks done`)
    return { result: formatReports(finished) }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, panel)).isAuto) return composed
    const text = autoSection(await read($, accounts), await read($, live))
    return text ? { sections: [...composed.sections, { id: 'relay:auto', text, scope: 'session' as const }] } : composed
  })

  on('command.run', { command: 'relay-delegate' }, async ($, e) => {
    const task = e.args.trim()
    if (!task) return { text: 'Usage: /relay-delegate <what the copy should do, and where to save it>' }
    return { text: await startJob($, task) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPanel($, e, e.props.bodyColumns ?? 40))

  on('ui.render', { component: 'CommandOutput', props: { command: 'relay-panel' } }, ($, e, next) =>
    e.props.text.startsWith(DOCKED) ? next(e) : drawPanel($, e, e.viewport?.columns ?? 60),
  )
}
