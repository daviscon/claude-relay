---
name: relay
description: Spread work across the user's other Claude accounts with the `relay` CLI. Use when the user says "delegate this to my other account", "use my second account", "split this across my accounts", "I'm running out of usage", or asks to run several independent jobs in parallel without burning this account's limit. Also use to check how much usage each account has left (`relay status`).
---

# relay: other Claude accounts as workers

`relay` is installed on this machine. The user has logged several Claude accounts into it. Each worker you start is a **fork of this conversation** running on another account: it already knows everything said here, and it bills that other account, not this one.

## With the relay plugin: use its tools

When the tools `mcp__relay__delegate` and `mcp__relay__accounts` are available, use them, not the shell:

- `mcp__relay__accounts`: usage on every account, which one this chat runs on, which goes next.
- `mcp__relay__delegate` with `tasks` (one string per worker, up to 6), and optionally `account` (all tasks there; left out, they spread over the accounts with the most room), `wait` (default true: you get the reports back; false: carry on and each report arrives in the chat later) and `fresh` (no conversation context, cheaper).

"Delegate this to work" means `account: "work"` (whatever the user named that account). "Split these across my accounts" means several tasks and no `account`. Jobs you start show up in the user's Relay panel.

## Without the plugin: the `relay` command

```bash
relay status
relay delegate "task one" "task two" "task three"
```

- Each quoted task becomes its own worker, spread across the accounts with the most usage left; the account running this chat is used last. `--as <account>` puts them all on one.
- By default every worker forks this conversation. Add `--fresh` for a worker that needs no context.
- Workers can take minutes. Run the command in the background (or with a long timeout) and keep going.
- Workers use the user's normal permission mode. If a task needs shell commands, pass extra claude flags after `--`, e.g. `-- --allowedTools "Bash(ffmpeg *)"`, or `--permission-mode auto`.

## Write good tasks

A worker sees this whole conversation but not your plans for the other workers. So each task must:

- name exactly what to produce and where to save it (full paths),
- own its files: never give two workers the same file,
- be independent: no worker waits on another.

Split by output ("render hook variant A to …/hookA.mp4"), not by step ("do the first half").

## When not to use it

- Small things you can do in a few tool calls. Forking re-reads the whole chat on the other account, so the overhead isn't worth it.
- Work that has to land in this conversation's own reasoning (a design decision, a judgment call the user is waiting on). Do that here.

## Moving this whole chat

If the user wants the chat itself to move to another account (not a side job), and this chat was started with `relay`, they type `! relay swap` (or `! relay swap <account>`). Claude restarts on the other account with the same conversation. If the chat was started some other way (like the desktop app), they open a terminal and run `relay resume`, then pick this chat.
