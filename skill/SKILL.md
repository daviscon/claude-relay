---
name: relay
description: Spread work across the user's other Claude accounts with the `relay` CLI. Use when the user says "delegate this to my other account", "use my second account", "split this across my accounts", "I'm running out of usage", or asks to run several independent jobs in parallel without burning this account's limit. Also use to check how much usage each account has left (`relay status`).
---

# relay: other Claude accounts as workers

`relay` is installed on this machine. The user has logged several Claude accounts into it. Each worker you start with `relay delegate` is a **fork of this conversation** running on another account: it already knows everything said here, and it bills that other account, not this one.

## Check headroom

```bash
relay status
```

Shows the 5-hour and weekly usage of every account and marks the one that goes next. Run it before a big delegation, or when the user asks what's left.

## Delegate

```bash
relay delegate "task one" "task two" "task three"
```

- Each quoted task becomes its own worker. Workers run in parallel, spread across the accounts with the most usage left. The account running this chat is used last.
- By default every worker forks this conversation. Add `--fresh` for a worker that needs no context; it's cheaper, because it doesn't re-read the chat.
- Workers can take minutes. Run the command in the background (or with a long timeout) and keep going; read the output when it finishes.
- Workers use the user's normal permission mode. If a task needs shell commands, pass extra claude flags after `--`, e.g. `-- --allowedTools "Bash(ffmpeg *)"`, or `--permission-mode auto`.
- Each worker ends with a report and a `relay resume <id>` line the user can use to continue that worker's chat.

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
