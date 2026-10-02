# pi-vcc: Duckwerks recognition POC

Internal-use fork of [sting8k/pi-vcc](https://github.com/sting8k/pi-vcc), based on
upstream `303e89db` (0.8.0). The npm badge and npm install instructions below refer
to **upstream**, not this fork. This fork has not been published to npm. Install
a reviewed Git revision to try the fork; do not load it alongside upstream.

## Additive recognition sidecar

V1 teaches extraction one extra command identity without changing ranking,
tail selection, transcript budgets or recall lineage. Set `recognitionProfilePath`
in VCC's config to the **absolute path** of a JSON sidecar:

```json
{
  "recognitionProfilePath": "/absolute/path/to/pi-vcc/examples/duckwerks-recognition.json"
}
```

The supplied sidecar contains:

```json
{
  "version": 1,
  "commitCommands": [
    { "id": "duckwerks.quack-commit", "tool": "bash", "argvPrefix": ["quack", "commit"] }
  ]
}
```

Profiles are read on each compaction. An absent/empty sidecar leaves built-in
extraction enabled; missing or invalid files produce a bounded warning and fall
back to built-in extraction. There is no profile discovery or executable code.
The contract allows at most 16 rules in a file no larger than 64 KiB. Each rule
requires a unique id, the `bash` tool, and 2–4 literal executable/subcommand tokens.
Unknown keys, duplicate identities and unsupported schema versions are rejected.

A recognized invocation has those literal tokens followed by exactly one body-file
argument. The adapter pairs a call and result by their unique tool-call ID, then
reads Git commit headers from the matched result. It never opens the body file,
runs Git, or treats a command attempt as a completed commit. Subjects are capped
at 200 characters; facts share the existing eight-commit cap. New entries carry a
result `#N` ref when available. IDs, error status and optional structured
exit/truncation metadata survive normalization, but raw result bodies are still
omitted from the brief. User-message refs now also survive noise cleaning.

Supported shell envelopes are standalone invocations, static `cd`/parenthesized
chains, and chains with `git add`, `git -C PATH add`, Git status, `git diff --check`,
`git diff --cached --check` (also with `-C PATH`), `quack log BODY_FILE`, or `rm` cleanup.
Quoted literal paths are supported. Expansion, heredocs, pipelines, redirection,
background execution, shell control flow, mixed unrecognized commit producers and
other command envelopes are deliberately unrecognized. A batch cannot contribute
more receipt headers than its recognized invocations. An explicit successful
receipt still counts if a later clause fails; it does not establish whole-batch
success or repository identity.

### Headless verification

With Bun and the Pi peer dependencies available locally, run `bun test`. The
frozen, de-identified pair in `tests/fixtures/quack-batch.json` has upstream before
and fork after text beside it. The profile tests assert exact hash/subject/ref
capture, fallback, identity pairing, conservative shell matching, chronological
caps and repeated-merge dedup. `tests/profile-hook.test.ts` exercises the actual
compaction hook with a fixed cut and session-global index map.

Keep test temp files, synthetic HOME, and the selected Pi agent directory
separate from live runtime state when running the suite. For the Duckwerks checkout, ignored `node_modules/.tmp` and
`node_modules/.test-home` serve this purpose:

```bash
mkdir -p node_modules/.tmp node_modules/.test-home
HOME="$PWD/node_modules/.test-home" TMPDIR="$PWD/node_modules/.tmp" \
  PI_CODING_AGENT_DIR="$PWD/node_modules/.test-home/.pi/agent" bun test
```

For a tiny live smoke session, set **Pi core's** `compaction.keepRecentTokens` to
`0` in the scratch workspace's `.pi/settings.json`, then reload or launch with
that project configuration approved. This is a smoke-only setting: core otherwise
rejects a small session before `session_before_compact` runs. VCC's explicit
`/pi-vcc keep:0` controls its own cut only after that gate; it cannot bypass core
preparation. Do not lower daily retention just to run this test.

The two upstream private-session tests skip in that isolated HOME. The existing
Bash/debug snapshot location can be overridden with `PI_VCC_DEBUG_PATH`, allowing
hook tests to keep snapshots in their own temp directory rather than writing to
the normal Pi runtime. `PI_VCC_CONFIG_PATH` selects an explicit config file for
an operator-approved trial. Neither override installs this fork. Do not load it
alongside the upstream compactor in the same Pi invocation.

Fresh goal extraction ignores complete observed `background_bash` completion
notices, including their command/output text. They remain transcript and recall
evidence. This does not retroactively scrub goal bullets from older summaries.

Built-in Git commit extraction now uses the same unique call/result pairing and
receipt headers, rather than attempted subjects or nearby hashes. Its narrow
static grammar supports `git [-C PATH] commit -m TEXT` / `--message TEXT`, with
optional `--amend`, `--allow-empty`, `--no-verify`, `--signoff` and `-a` flags.
The receipt supplies the subject and result reference. Failed attempts without
headers, ambiguous identities, mixed Git/Quack producers and unsupported shell
syntax add no commit facts. `git commit -F` and additional flags remain unsupported.
Raw attempts remain transcript and recall evidence; old summary facts are not
retroactively repaired. Profile-disabled Quack behavior remains unchanged.

Further cleanup and any LLM continuity note remain separate from this POC.

## User-pinned session goal

`/goal TEXT` pins one short reference goal (up to 500 characters). `/goal` shows
it; `/goal clear` clears it. `/goal set TEXT` also works, including when the text
is the reserved word `clear`. Whitespace is normalized. Commands do not start
an agent turn, make a model call, or infer progress.

The pin lives in a versioned custom session entry, reconstructed from the active
branch on each operation. Resume/reload retain it; tree navigation follows the
chosen ancestry, never abandoned branches. New sessions start empty. Branch
export retains the metadata. A clear is an explicit tombstone with its reason,
not deletion of history.

The agent sees one request-local reference message, separate from the system
prompt. VCC snapshots it under `[User-pinned Goal]` at compaction. That snapshot
is not authority: subsequent requests remove the snapshot and render current
metadata, so replacing or clearing a pin cannot revive it from an old summary.
Ordinary user instructions take precedence. No goal means no reference message,
and the existing extraction/ranking/cut/recall behavior is unchanged.

`vcc_goal` gives the agent `action: "get"` or `action: "clear"`. Get returns
`goal: {entryId, text}` or `null`. Clear requires the returned `entryId` as
`expectedId` and a short accomplishment `reason`; a missing or replaced pin
refuses without a write. Agents cannot set goals through this tool. Land can
clear a pin only when its agreed result accomplishes that goal, recording the
clearance in history; partial, paused and unrelated goals remain.

There is no goal detector, reminder, planner, completion inference, shared file
or cross-session goal database. The old regex `[Session Goal]` section remains
historical extraction, distinct from the explicit pin; its broader cleanup is
still a separate follow-up.

---

## Upstream project

[![npm](https://img.shields.io/npm/v/@sting8k/pi-vcc)](https://www.npmjs.com/package/@sting8k/pi-vcc)

Algorithmic conversation compactor for [Pi](https://github.com/badlogic/pi-mono). No LLM calls — produces a brief transcript via extraction and formatting.

Inspired by [VCC](https://github.com/lllyasviel/VCC) **(View-oriented Conversation Compiler)**.

## Demo

![pi-vcc demo](./demo.gif)

## Why pi-vcc

|  | Pi default | pi-vcc |
|---|---|---|
| **Method** | LLM-generated summary | Algorithmic extraction, no LLM |
| **Determinism** | Non-deterministic, can hallucinate | Same input = same output, always |
| **Token reduction** | Varies | 35-99% on real sessions (higher on longer sessions) |
| **Compaction latency** | Waits for LLM call | 30-470ms, no API calls |
| **History after compaction** | Older messages omitted from context; originals remain in the session file | Active lineage searchable via `vcc_recall` (`scope:"all"` available) |
| **Repeated compactions** | Each rewrite risks losing more | Sections merge and accumulate |
| **Cost** | Burns tokens on summarization call | Zero — no API calls |
| **Structure** | Free-form prose | Brief transcript + 4 semantic sections |

## Features

- **No LLM** — purely algorithmic, zero extra API cost
- **Brief transcript** — chronological conversation flow, each tool call collapsed to a one-liner with `(#N)` refs, text truncated to keep it compact
- **5 semantic sections** — session goal, files & changes, commits, outstanding context, user preferences
- **Bounded merge** — rolling sections re-capped after merge instead of growing unbounded
- **Lossless recall** — `vcc_recall` reads raw session JSONL, so active-lineage history stays searchable across compactions
- **Scoped recall** — default search is active lineage; use `scope:"all"` / `scope:all` to intentionally search across all lineages
- **Regex search** — `vcc_recall` supports regex patterns (`hook|inject`, `fail.*build`) and OR-ranked multi-word queries
- **Result ranking** — search results ranked by term relevance, rare terms weighted higher than common ones
- **`/pi-vcc-recall`** — slash command to search history directly, results shown as collapsible message and auto-fed to agent as context
- **Fallback cut** — still works when Pi core returns nothing to summarize
- **`/pi-vcc`** — manual compaction on demand

## Install

```bash
pi install npm:@sting8k/pi-vcc
```

Or from GitHub:

```bash
pi install https://github.com/sting8k/pi-vcc
```

Or try without installing:

```bash
pi -e https://github.com/sting8k/pi-vcc
```

## Usage

pi-vcc runs automatically when your context window fills up, or on-demand via commands.

### Compaction

- **`/pi-vcc`** — manual compaction, keeps the last 1 user turn by default.
- **`/pi-vcc keep:N [prompt]`** — keep the last `N` user turns; optional prompt is sent to the agent after compaction.
  - `keep:1` = default, `keep:0` = compact everything, no tail.
- By default pi-vcc also handles `/compact` and auto-threshold compactions. Set `overrideDefaultCompaction: false` to send those paths back to Pi core.
- **Smart keep**: when enabled, pi-vcc auto-boosts `keep:1` to a larger N if the tail is small enough (≤ 5k tokens, capped at 25k).

### Compacted message structure

```
[Session Goal]
- Fix the authentication bug in login flow
- [Scope change]
- Also update the session token refresh logic

[Files And Changes]
- Modified: src/auth/session.ts
- Created: tests/auth-refresh.test.ts

[Commits]
- a1b2c3d: fix(auth): refresh token after password reset

[Outstanding Context]
- lint check still failing on line 42

[User Preferences]
- Prefer Vietnamese responses
- Always run tests before committing

[user]
Fix the auth bug, users can't log in after password reset

[assistant]
Root cause is a missing token refresh after password reset...
* bash "bun test tests/auth.test.ts" (#12)
* edit "src/auth/session.ts" (#14)
* bash "bun test tests/auth.test.ts" (#16)
...(28 earlier lines omitted)
```

Sections appear only when relevant — a session with no git commits won't have `[Commits]`.

**Sections:**

| Section | Description |
|---|---|
| `[Session Goal]` | Initial goal + scope changes (regex-based extraction) |
| `[Files And Changes]` | Modified/created files from tool calls (capped, paths trimmed to common root) |
| `[Commits]` | Git commits made during the session (last 8, hash + first line) |
| `[Outstanding Context]` | Unresolved items — errors, pending questions |
| `[User Preferences]` | Regex-extracted from user messages (`always`, `never`, `prefer`...) |
| Brief transcript | Chronological conversation flow — rolling window of ~120 recent lines, tool calls collapsed to one-liners with `(#N)` refs |

## Recall (Lossless History)

Pi's default compaction omits older messages from model context, retaining a summary and recent tail. Original entries remain in the session file.

`vcc_recall` bypasses this by reading the raw session JSONL file directly, so anything dropped by compaction stays reachable. By default it covers the active conversation lineage, regardless of how many compactions have happened. Use `scope:"all"` to also reach messages from other branches, such as turns that were edited or retried. Scope is limited to the current session — earlier sessions are not searchable.

**Plain keywords work best.** Multi-word queries are OR-matched and ranked by relevance; a regex pattern is also accepted, and if it matches nothing the query falls back to keyword search:

```
vcc_recall({ query: "auth token" })                  // active-lineage OR search, ranked
vcc_recall({ query: "auth token", page: 2 })           // paginated (5 results/page)
vcc_recall({ query: "hook|inject" })                  // regex pattern
vcc_recall({ query: "auth token", scope: "all" })    // search all lineages
```

Manual slash command:

```
/pi-vcc-recall auth token scope:all
```

## Pipeline

1. **Calibrate** — estimate `charsPerToken` from `preparation.tokensBefore` vs actual message chars (falls back to heuristic `4 chars/token`)
2. **Smart keep**: if `keep:1` tail is small (≤ 5k tokens), boost keep to the largest N whose tail stays ≤ 25k tokens; explicit `keep:N` is always respected
3. **Build cut** — split at the keep boundary; everything before is summarized, the tail stays intact
4. **Normalize** — raw Pi messages → uniform blocks (user, assistant, tool_call, tool_result, thinking)
5. **Filter noise** — strip system messages, empty blocks
6. **Build sections** — extract goal, file paths, commits, outstanding context, preferences
7. **Brief transcript** — chronological conversation flow, tool calls collapsed to one-liners, text truncated
8. **Format** — render into bracketed sections + transcript
9. **Merge** — if previous summary exists: sticky sections dedup, volatile sections replace, transcript rolls

## Config

Config lives at `pi-vcc-config.json` inside Pi's selected agent directory,
resolved through the host's `getAgentDir()`. It honors `PI_CODING_AGENT_DIR`;
without that override Pi defaults to `~/.pi/agent`. The file is auto-scaffolded
on first load with safe defaults. `PI_VCC_CONFIG_PATH` explicitly overrides this
location for isolated trials. Existing files in a former agent directory are
not silently migrated or deleted; move approved settings before switching.

Debug snapshots also default to the selected agent directory, at
`pi-vcc-debug.json`, with `PI_VCC_DEBUG_PATH` available as an explicit override.
Debug remains off unless enabled.

Defaults:

```json
{
  "overrideDefaultCompaction": true,
  "smartKeepTail": true,
  "continueAfterThresholdCompact": true,
  "debug": false,
  "skipForProviders": [],
  "skipCustomTypes": []
}
```

- **`overrideDefaultCompaction`** *(default `true`)*: when `true`, pi-vcc handles all compaction paths — `/pi-vcc`, `/compact`, and auto-threshold/overflow. Set `false` to restrict pi-vcc to `/pi-vcc` and let the rest fall through to pi core. Existing config files keep whatever value they already have.
- **`smartKeepTail`** *(default `true`)*: when `true`, pi-vcc boosts the default `keep:1` to the largest `N` whose tail stays ≤ 25k tokens, but only when the `keep:1` tail is already small (≤ 5k tokens). Explicit `keep:N` from the user is always respected.
- **`continueAfterThresholdCompact`** *(default `true`)*: permission for pi-vcc to ask the agent to continue after a successful automatic compaction (threshold or overflow), avoiding a UX cliff where the agent stops after compaction instead of continuing the task. It only applies to pi < 0.84.4 - from 0.84.4 on, pi core resumes the run itself, so pi-vcc never sends its own continue (a second one would land as a ghost turn). `false` disables it on every version.
- **`debug`** *(default `false`)*: when `true`, each compaction writes detailed info to `pi-vcc-debug.json` in Pi's selected agent directory — message counts, cut boundary, summary preview, sections, token estimate calibration.
- **`skipForProviders`** *(default `[]`)*: providers pi-vcc defers compaction for, so a provider-specific compaction extension (e.g. remote compaction for OpenAI/Grok models) can take over instead. Matched exactly and case-insensitively against Pi's provider id — check `/model` for the actual id (Grok is `xai`, not `grok`). The check runs per compaction, so switching models mid-session works. Explicit `/pi-vcc` always bypasses the skip.
- **`skipCustomTypes`** *(default `[]`)*: list of `customType` values whose `custom_message` entries are excluded from the summarizer input. Some extensions inject per-turn boilerplate via `custom_message` (e.g. skill cards, guidance blocks) that gets regenerated every turn — summarizing it wastes tokens and pollutes the summary. Match is exact and case-sensitive on `customType`; find an extension's value in your session file (`"type":"custom_message"` entries). Only the summary input is filtered: cut selection, token calibration, and kept-tail counting are unaffected. Extensions that inject ephemeral per-turn content should carry a stable `customType` so compactors can exclude them.

## Benchmarks

Local benchmarks / research comparing the ranked brief against the shipped pi-vcc 0.3.18 baseline (recall, fact-density, precision, size) live in [`benchmarks/README.md`](./benchmarks/README.md).

## Related Work

- [VCC](https://github.com/lllyasviel/VCC) — the original transcript-preserving conversation compiler
- [Pi](https://github.com/badlogic/pi-mono) — the AI coding agent this extension is built for

## Acknowledgments

- Recall `mode:"touched"` + `#N:path` drill-down ported from
  [pi-blackhole](https://github.com/k0valik/pi-blackhole) by [@k0valik](https://github.com/k0valik),
  who also suggested the feature.
- Invisible auto-continue pattern ported from
  [monotykamary/pi-vcc](https://github.com/monotykamary/pi-vcc) (`tom` branch) by [@monotykamary](https://github.com/monotykamary).

## License

MIT
