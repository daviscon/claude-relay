import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'relay',
  component: 'Pane',
  requestId: 'relay',
  props: {
    title: 'Relay',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Two accounts as `relay status --json` prints them. "main" resets when
// this chat's own windows do, so it is the account this chat runs on.
const FIVE_RESET = 1_900_000_000
const WEEK_RESET = 1_900_300_000
const STATUS = JSON.stringify({
  second: {
    ok: true,
    five_hour: { used: 0.46, resets: 1_900_001_000, status: 'allowed' },
    seven_day: { used: 0.55, resets: 1_900_200_000, status: 'allowed' },
  },
  main: {
    ok: true,
    five_hour: { used: 0.05, resets: FIVE_RESET, status: 'allowed' },
    seven_day: { used: 0.85, resets: WEEK_RESET, status: 'allowed_warning' },
  },
})

const iso = (secs: number) => new Date(secs * 1000).toISOString()

function engine(on: Parameters<Parameters<typeof test>[1]>[1], ran: string[][], isPlaced = true) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no surface here places panes' } }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'test' } }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_899_990_000_000 }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__relay__${e.name}` } }))
  const store: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: store[e.key] }) as never)
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  on('process.spawn', async function* (_, e) {
    ran.push([...e.argv])
    const task = e.argv.at(-1) ?? ''
    const as = e.argv.includes('--as') ? e.argv[e.argv.indexOf('--as') + 1] : 'second'
    yield { stream: 'stderr' as const, text: 'relay: worker 1 → ...\n' }
    yield { stream: 'stdout' as const, text: JSON.stringify([{ task, account: as, ok: true, result: `did: ${task}`, seconds: 12, session_id: 'fork-1' }]) }
    return { value: { code: 0, signal: null } }
  } as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.StopFailure', () => ({}))
  on('command.run', () => ({ text: 'engine' }))
  on('session.id', () => ({ value: 'sess-1234' }))
  on('session.cwd', () => ({ value: '/work/project' }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const isStatus = e.argv.includes('status')
    return { value: { exitCode: 0, stdout: isStatus ? STATUS : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

async function start($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
  await $.session.measure({
    context: { window: 200_000 } as never,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 5, resetsAt: iso(FIVE_RESET) },
      { kind: 'seven_day', percentUsed: 85, resetsAt: iso(WEEK_RESET) },
    ],
    changed: ['rateLimits'],
  })
  // the panel's first refresh runs in the background; ask for one we await
  await $.command.run({ command: 'relay-status', args: '' } as never)
}

test('the panel shows each account, which one this chat is on, and who is next', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'second' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'this chat' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'next up' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^week .*85%$/ }))?.text).toBeDefined()
    expect(await ui.find({ key: 'go-second' })).toBeDefined()
    expect(await ui.find({ key: 'go-main' })).toBeUndefined()
    await ui.unmount()
  }
  expect(ran.some(argv => argv.at(-1) === '--refresh' || argv.includes('--json'))).toBe(true)
})

test('hitting the limit offers the other account, and the button reopens this chat there', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await start($)
  await $.classic.StopFailure({ error: 'rate_limit' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'main is out of usage' })).toBeDefined()
    expect(await ui.find({ key: 'go-next' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'go-next' })
  const osa = ran.find(argv => argv[0] === 'osascript')
  expect(osa?.join(' ')).toMatch(/resume sess-1234 --as 'second'/)
  expect(await ui.find({ type: 'Text', text: 'Moved to Terminal on second' })).toBeDefined()
  await ui.unmount()
})

test('/relay-swap names a missing account and moves to a real one', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await start($)

  const missing = await $.command.run({ command: 'relay-swap', args: 'nope' } as never)
  expect(missing.text).toMatch(/No relay account called "nope"/)

  const same = await $.command.run({ command: 'relay-swap', args: 'main' } as never)
  expect(same.text).toMatch(/already on "main"/)

  const moved = await $.command.run({ command: 'relay-swap', args: '' } as never)
  expect(moved.text).toMatch(/continues in Terminal on "second"/)
})

test('/relay-add opens the login in Terminal and refuses a bad name', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await start($)

  const bad = await $.command.run({ command: 'relay-add', args: 'my account' } as never)
  expect(bad.text).toMatch(/^Usage/)

  const ok = await $.command.run({ command: 'relay-add', args: 'second' } as never)
  expect(ok.text).toMatch(/logging in "second"/)
  expect(ran.find(argv => argv[0] === 'osascript')?.join(' ')).toMatch(/add 'second'/)
})

test('where no pane can dock, /relay-panel draws the panel in the chat', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran, false)
  await start($)

  const out = await $.command.run({ command: 'relay-panel', args: '' } as never)
  expect(out.text).toMatch(/couldn't dock a panel here \(no surface here places panes\)/)

  const ui = await $.ui.mount({
    plugin: 'relay',
    component: 'CommandOutput',
    requestId: 'row-1',
    props: { command: 'relay-panel', args: '', text: out.text ?? '', isErrored: false },
    surface: 'desktop',
  } as never)
  expect(await ui.find({ type: 'Text', text: 'second' })).toBeDefined()
  expect(await ui.find({ key: 'go-second' })).toBeDefined()
  await ui.unmount()
})

test('Claude can delegate through the tool and gets the reports back', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await start($)

  const res = await $.tool.call({ tool: 'mcp__relay__delegate', tasks: ['render hook A', 'render hook B'] } as never)
  const text = String((res as { result?: unknown }).result)
  expect(text).toMatch(/## render hook A/)
  expect(text).toMatch(/did: render hook B/)
  expect(text).toMatch(/Account: second · done · 12s/)
  const spawns = ran.filter(argv => argv.includes('delegate'))
  expect(spawns.length).toBe(2)
  expect(spawns.every(argv => argv.includes('--fork') && argv.includes('sess-1234'))).toBe(true)

  const bad = await $.tool.call({ tool: 'mcp__relay__delegate', tasks: ['x'], account: 'nope' } as never)
  expect(String((bad as { deny?: string; text?: string }).deny ?? (bad as { text?: string }).text)).toMatch(/No relay account called "nope"/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /render hook A/ })).toBeDefined()
  await ui.unmount()
})

test('auto-delegate adds its nudge only when on and this account is past 90%', async ($, on) => {
  const ran: string[][] = []
  engine(on, ran)
  await start($)
  const compose = () => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)

  expect((await compose()).sections.some(x => x.id === 'relay:auto')).toBe(false)
  await $.command.run({ command: 'relay-auto', args: 'on' } as never)
  // main is at 85% of its week: under the line
  expect((await compose()).sections.some(x => x.id === 'relay:auto')).toBe(false)
  await $.session.measure({
    context: { window: 200_000 } as never,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 5, resetsAt: iso(FIVE_RESET) },
      { kind: 'seven_day', percentUsed: 93, resetsAt: iso(WEEK_RESET) },
    ],
    changed: ['rateLimits'],
  })
  const nudge = (await compose()).sections.find(x => x.id === 'relay:auto')
  expect(nudge?.text).toMatch(/93% of its weekly usage/)
  expect(nudge?.text).toMatch(/account "second"/)
  await $.command.run({ command: 'relay-auto', args: 'off' } as never)
  expect((await compose()).sections.some(x => x.id === 'relay:auto')).toBe(false)
})
