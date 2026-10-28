/** One relay account as `relay status --json` last read it. Percentages 0-100. */
export type Account = {
  name: string
  five: number | null
  week: number | null
  fiveResets: number | null
  weekResets: number | null
  isBlocked: boolean
  error: string | null
}

/** The windows this chat's own responses report, pushed by session.measure. */
export type Live = {
  five: number | null
  week: number | null
  fiveResets: number | null
  weekResets: number | null
}

/** A side task running, or run, as a fork of this chat on another account. */
export type Job = {
  id: string
  task: string
  account: string
  state: 'running' | 'done' | 'failed'
  result: string | null
  seconds: number | null
  sessionId: string | null
}

export type Panel = {
  checkedAt: number | null
  isChecking: boolean
  message: string | null
  outAt: number | null
  handedTo: string | null
  isAuto: boolean
}

declare module 'claude-code' {
  interface PluginState {
    relay: {
      accounts: Account[]
      live: Live | null
      jobs: Job[]
      panel: Panel
    }
  }
}
