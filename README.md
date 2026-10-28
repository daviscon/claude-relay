# relay

**One Claude Code conversation, several Claude accounts.**

You're deep in a long chat with Claude, it knows your whole project, and then: *"You've hit your limit."* Opening your other account means a fresh chat that knows nothing.

relay fixes that. When one account runs out, the **same conversation** carries on on your next account, mid-task, with every message intact. It can also fork the conversation onto your other accounts as parallel workers, the way Claude Code hands work to subagents.

```
$ relay status
account        5-hour             weekly             note
main           ██████████  100%   ███████░░░   71%   5h resets in 1h 12m
second         ██░░░░░░░░   18%   ███░░░░░░░   33%   ← next up
third          ░░░░░░░░░░    4%   ████████░░   85%
```

## How it works

A Claude Code conversation isn't stored in your account. It's a transcript file on your Mac (`~/.claude/projects/…/<session>.jsonl`). The account only decides **who pays for the next message**.

So relay keeps one login token per account (from `claude setup-token`, saved in your macOS Keychain). It launches `claude` with whichever account has the most usage left. When that account hits its limit, a Claude Code hook tells relay, and relay:

1. checks every account's 5-hour and weekly usage,
2. picks the one with the most room,
3. reopens the same transcript on it with `claude --resume`, plus a note telling Claude to carry on.

Nothing is copied or summarised, and nothing is lost.

## Install

Needs macOS (Linux works for everything except the buttons that open Terminal), Python 3 and [Claude Code](https://claude.com/claude-code).

**As a Claude Code plugin** (gives you the panel, the slash commands and the `/relay` skill). At the prompt of a terminal session:

```
/plugin install relay --marketplace daviscon/claude-relay
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one). From a shell, it's `claude plugin install relay --marketplace daviscon/claude-relay`. In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `daviscon/claude-relay`, then **Add plugin**.

**The `relay` terminal command** (for `relay`, `relay resume` and the rest below):

```bash
git clone https://github.com/daviscon/claude-relay.git
cd claude-relay && ./install.sh
```

Then add your accounts, either with `/relay-add <name>` inside Claude or in a terminal:

```bash
relay add main --login   # whatever `claude` is already logged into
relay add second         # browser login: sign in with your other account
relay add third
relay status
```

`relay add` runs Claude Code's own `claude setup-token` login, which gives you a token that lasts a year. Before running it, switch claude.ai in your browser to the account you want for that slot.

## The panel

Type `/relay-panel` and relay docks beside your chat, in the desktop app and in a fullscreen terminal:

- every account's 5-hour and weekly usage, with the one this chat runs on and the one that goes next marked;
- **when this chat hits its limit**, the panel opens by itself and offers **Continue this chat on _second_**. One click reopens this exact conversation in Terminal on that account;
- **Side task**: type a task and a copy of this chat does it on your other account, then hands its report back into this conversation, the way a subagent's result comes back.

### Just ask Claude

With the plugin installed, Claude has a `delegate` tool. Say it the way you'd say it to a person:

- "Delegate the B-roll search to my second account."
- "Split these three renders across my accounts."
- "Send that research to my other account and keep going here."

Each job runs as a copy of this chat on the other account and shows up in the panel. Claude either waits for the reports or carries on and gets them when they land.

**Auto-delegate** (off by default; turn it on with the panel's switch or `/relay-auto on`): once this chat's account passes 90% of its 5-hour or weekly usage, Claude starts sending big, independent jobs to the account with the most room by itself, and tells you when it does. Small steps and decisions stay in your chat.

A Claude Code mod can't change which account a running chat uses, so the hand-off opens Terminal instead of switching in place. The desktop chat stays where it was; carry on in Terminal.

| slash command | does |
|---|---|
| `/relay-panel` | open the panel |
| `/relay-status` | usage on every account, as text |
| `/relay-swap [account]` | continue this chat in Terminal on another account |
| `/relay-delegate <task>` | run a side task as a copy of this chat on your other account |
| `/relay-add <name> [--login]` | log in another account (opens Terminal) |
| `/relay-auto [on\|off]` | let Claude delegate big jobs by itself near the limit |

## Use it

### 1. Start chats with `relay` instead of `claude`

```bash
relay                     # same as `claude`, on the account with most headroom
relay --resume <id>       # any claude flags work
relay --as second         # pick the account yourself
```

When the account runs dry, relay moves the chat to the next one by itself:

```
▸ relay "main" is out of usage, checking the others…
▸ relay moving this conversation from "main" to "second"
▸ relay account "second" (5h 18%, 7d 33% used)
```

To move on purpose (say you want to save an account for later), type this inside Claude:

```
! relay swap            # next best account
! relay swap third      # a specific one
```

### 2. Rescue a chat that already ran out

Your chat in the Claude desktop app (or any terminal) just hit the limit:

```bash
relay resume              # pick from your recent chats
relay resume --last       # the most recent one
relay resume 39353db6     # by session id
```

It reopens that exact conversation in your terminal on an account with room left. `relay sessions` lists your recent chats with their titles.

### 3. Delegate work to your other accounts

From inside any Claude Code chat (or by asking Claude, once the `/relay` skill is installed):

```bash
relay delegate "render hook A to out/hookA.mp4" "render hook B to out/hookB.mp4"
```

Each task becomes a worker that is a **fork of the current conversation**, so it already knows everything. Workers run in parallel and spread evenly across the accounts with the most headroom. Each returns a report and the session id, so you can continue any worker's chat later.

```bash
relay delegate --fresh "summarise this repo's README"            # no context, cheaper
relay delegate "…" -- --allowedTools "Bash(ffmpeg *)"            # extra claude flags after --
relay delegate --permission-mode auto "…"
```

## Commands

| command | does |
|---|---|
| `relay [claude args]` | run Claude on the best account, with automatic hand-off |
| `relay add <name> [--login]` | add an account |
| `relay rm <name>` | forget an account and delete its token |
| `relay list` | list accounts |
| `relay status [--refresh]` | 5-hour and weekly usage for every account |
| `relay pick` | print the account with the most headroom |
| `relay sessions` | recent conversations on this machine |
| `relay resume [id \| --last]` | continue a conversation on the best account |
| `relay swap [account]` | move the running relay chat to another account |
| `relay delegate "task" …` | run tasks as forked workers across accounts |
| `relay install-skill` | install the `/relay` skill so Claude knows how to delegate |

## Good to know

- **Checking usage costs almost nothing.** `relay status` sends one tiny Haiku message per account through Claude Code itself and reads the usage figures that come back (well under a cent each). Readings are cached for a couple of minutes.
- **The first message after a move costs more.** Your new account has no cached copy of the conversation, so it reads the whole chat once. A very long chat can take a noticeable bite out of the new account's 5-hour window.
- **One window per chat.** Don't type into the same conversation in two places at once (say, the desktop app and a relay terminal). Both write to the same transcript.
- **Tokens stay on your machine.** On macOS they're stored in the Keychain under `claude-relay`; on Linux they're in `~/.claude-relay/tokens/` with `0600` permissions. relay never sends them anywhere except to Claude Code.
- **Only use accounts you own.** relay is for people who pay for more than one Claude plan. It doesn't share accounts between people. Check Anthropic's terms for your plans.

## Uninstall

```bash
for a in $(relay list | awk '{print $1}'); do relay rm "$a"; done
rm ~/.local/bin/relay ~/.claude/skills/relay/SKILL.md
claude plugin uninstall relay   # if you installed the plugin
rm -rf ~/.claude-relay
```

MIT licensed.
