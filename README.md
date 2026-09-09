# pi-interactive-subagents

Async subagents for [pi](https://github.com/badlogic/pi-mono), running as native in-process `AgentSession` instances. Spawn a sub-agent, keep working in the main session, and get the result steered back when it finishes. Fully non-blocking.

## How it works

`subagent()` returns immediately. The sub-agent owns an independent pi session and JSONL transcript while sharing the parent process. A live widget above the input tracks every running sub-agent, and when one finishes, its result is steered into the main session as a notification that triggers a new turn.

```
╭─ Subagents ──────────────────────────── 2 running ─╮
│ 00:23  scout      active · bash 7m                 │
│ 00:45  scout-2    waiting 2m                       │
╰────────────────────────────────────────────────────╯
```

Spawn several in parallel — they run concurrently and steer results back independently as each finishes.

Use `/subagent-focus <name>` to route editor input to a child, `/subagent-focus parent` to return, or `Ctrl+Alt+S` to select a running child.

## Tools

| Tool | Description |
| --- | --- |
| `subagent` | Spawn a native pi sub-agent (async) |
| `subagent_message` | Message a sub-agent by name — steers it if running, resumes its session if finished |
| `subagent_list` | List spawned sub-agent sessions and their latest persisted result |
| `subagent_read` | Read the latest persisted result from one spawned sub-agent |
| `subagent_cancel` | Cancel a running session by name while preserving its transcript |
| `subagent_transcript` | Read paginated transcript messages, optionally including tool results |
| `subagent_tools` | Inspect the persisted sandbox, tool allowlist, model, cwd, and spawn permissions |
| `subagent_fork` | Create a new named session from an existing transcript and sandbox |
| `subagent_restart` | Start a fresh session with a finished sub-agent's sandbox |
| `subagent_diagnostics` | Inspect runtime, activity, session, sidecar, statistics, and event diagnostics |
| `subagents_list` | List available agent definitions |
| `ask_question` | *(sub-agent sessions only)* Ask the orchestrator a question and wait for the reply |
| `report_progress` | *(sub-agent sessions only)* Publish a non-blocking milestone to the orchestrator |
| `publish_artifact` | *(sub-agent sessions only)* Publish an existing file from the sub-agent cwd |

There is also a `/subagent <agent> <task>` command for spawning directly.

### Spawning

```typescript
subagent({ agent: "scout", task: "Analyze the auth module" });
subagent({ agent: "worker", name: "dark-mode", task: "Implement the dark mode toggle" });
```

| Parameter | Type | Default | Description |
| --------- | ---- | ------- | ----------- |
| `agent` | string | required | Which agent to spawn (must be known and permitted) |
| `task` | string | required | Task prompt |
| `name` | string | agent name | Display name for the subagent and widget. Must be unique — duplicates are auto-suffixed (`scout`, `scout-2`, …) |
| `model` | string | agent's model | Override the model for this spawn |
| `cwd` | string | agent's `cwd` | Working directory (see [Role folders](#role-folders)) |

### Messaging

`subagent_message` is addressed **by name only**. Names are unique per session and persist after a sub-agent finishes, so the same name works either way:

```typescript
subagent_message({ name: "scout", message: "Also check the auth middleware" });
```

- **Running** — the message is steered into the native session and picked up at the next turn boundary. The call returns immediately; the eventual completion still arrives as a steer message.
- **Finished** — the session is resumed with the message as the follow-up task, like a fresh spawn: fire-and-forget, always autonomous, result steered back later. The resumed run reclaims its original name.

Every spawn records name → session file in `artifacts/<sessionId>/subagent-registry.json`, so names stay addressable across pi restarts. A nested sub-agent that spawns children gets its own registry keyed by its own session id. Resume is refused with a clear error (listing known names) if the name isn't registered, the session file is gone, or the session predates sandboxed resume.

**Resume replays the original sandbox.** At spawn time the fully-resolved loadout — tool allowlist, backing extensions, model, thinking level, system prompt, spawn whitelist, cwd — is snapshotted to `<session>.loadout.json`. Resume rebuilds the exact same restricted process from that snapshot rather than relaunching unrestricted.

### Session control and inspection

```typescript
subagent_cancel({ name: "dark-mode" });
subagent_transcript({ name: "scout", limit: 20, includeTools: false });
subagent_tools({ name: "scout" });
subagent_diagnostics({ name: "scout" });
subagent_fork({ name: "scout", newName: "scout-alt", task: "Try the alternate approach" });
subagent_restart({ name: "scout", task: "Repeat from a clean transcript" });
```

Transcript pages are returned newest-first by page while retaining chronological
order inside each page. Pass the returned `nextBefore` id as `before` to read
the preceding page. Fork copies the complete source transcript into a new
session; restart creates a fresh transcript. Both replay the source sandbox and
deliver completion asynchronously like `subagent`.

### Progress and artifacts

Sub-agents can publish milestones without blocking or asking a question:

```typescript
report_progress({ message: "Implementation complete; running tests", percent: 75 });
publish_artifact({ path: "reports/audit.md", description: "Security audit" });
```

Progress and artifact events are persisted beside the child session and shown
to the parent immediately. Published files must already exist and remain inside
the sub-agent working directory; publication exposes the path, it does not copy
or upload the file.

### ask_question

A sub-agent can ask its orchestrator a single freeform question when requirements are ambiguous or a decision materially affects the work. The session **stays open** (parked as `waiting`) instead of exiting; the parent is notified with the sub-agent's name, replies via `subagent_message({ name, message })`, and the reply arrives as the sub-agent's next turn. Parallel questions are supported — each waiting sub-agent has its own name.

If the reply arrives while the sub-agent is still mid-turn, it is absorbed into the current turn — either way the question is marked answered and the session exits normally when the work is done. If the parent never replies, the session stays open until it is resumed. Only available inside sub-agent sessions.

## Test suite

The project uses Bun. The deterministic suite runs without network access:

```bash
npm test
npm run test:integration
npm run test:e2e
```

The native orchestration E2E tests use Pi's faux provider and cover persistent
transcripts, tool allowlists, parallel sessions, and resume behavior. An
optional real-provider smoke test is available when credentials are configured:

```bash
npm run test:e2e:real
```

That smoke test is skipped unless `PI_E2E_REAL_MODEL=1` is set by the script.

### Provider credentials

Pi accepts provider credentials either through environment variables or through
`~/.pi/agent/auth.json`. Never commit API keys to the repository.

Common API-key providers:

| Provider | Environment variable |
| --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |

Set a key before starting Pi. For Bash or Git Bash:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
pi
```

For PowerShell:

```powershell
$env:OPENROUTER_API_KEY = "sk-or-v1-..."
pi
```

Alternatively, authenticate interactively with `/login` when the provider
supports OAuth. API keys can also be stored in `~/.pi/agent/auth.json`:

```json
{
  "openrouter": { "type": "api_key", "key": "sk-or-v1-..." }
}
```

The real-provider smoke test also needs a configured default model. Point
`PI_CODING_AGENT_DIR` at the Pi configuration directory containing your
`auth.json` and model/settings configuration. For example, with OpenRouter:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
npm run test:e2e:real
```

PowerShell:

```powershell
$env:OPENROUTER_API_KEY = "sk-or-v1-..."
$env:PI_CODING_AGENT_DIR = "$HOME/.pi/agent"
npm run test:e2e:real
```

The test reads the default provider/model from that configuration directory.
If no model is configured, the SDK reports `provider: unknown`; start Pi,
select a model with `/model`, and retry. To verify only the deterministic
tests (without credentials or network access), run:

```bash
npm test
npm run test:integration
npm run test:e2e
```

The complete provider list and cloud-provider setup are documented in Pi's
[provider guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md).

## Bundled agents

| Agent | Model | Tools | Role |
| ----- | ----- | ----- | ---- |
| **scout** | `openrouter/z-ai/glm-5.3` | `read`, `grep`, `find`, `ls` | Fast read-only codebase recon |
| **researcher** | `openrouter/z-ai/glm-5.3` | `web_search`, `web_fetch`, `safe_bash` | Web research, synthesized into a sourced brief |
| **worker** | `openrouter/z-ai/glm-5.3` | `read`, `write`, `edit`, `bash`, `web_search`, `web_fetch` + spawning | General implementer; may spawn `scout` and `researcher` |

All three are autonomous (`auto-exit: true`) and carry their identity in the system prompt (`system-prompt: append`).

## Custom agents

Place a `.md` file in `.pi/agents/` (project) or `~/.pi/agent/agents/` (global). Discovery priority: **project > global > package-bundled** — a project-local file overrides a bundled agent with the same name.

```markdown
---
name: my-agent
description: Does something specific
model: openrouter/z-ai/glm-5.3
thinking: medium
tools: read, edit, write, safe_bash, web_search
session-mode: lineage-only
auto-exit: true
---

You are a specialized agent that does X...
```

### Frontmatter reference

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Agent name (used in `agent: "my-agent"`) |
| `description` | string | Shown in `subagents_list` |
| `model` | string | Default model |
| `thinking` | string | `minimal`, `low`, `medium`, or `high` |
| `tools` | string | Strict tool allowlist. Built-ins: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`. Extension-backed: `web_search`, `web_fetch`, `safe_bash`, `video_extract`, `youtube_search`, `google_image_search`. Only the extensions backing the listed tools are loaded into the child |
| `subagent_agents` | string | Comma-separated agent names this agent may spawn. **Presence of this field grants the spawning and child-session management tools** and restricts spawn targets to the list. Omit it and the agent cannot spawn or manage children |
| `skills` | string | Comma-separated skill names to auto-load |
| `session-mode` | string | `standalone` (default), `lineage-only`, or `fork` — see below |
| `system-prompt` | string | `append` or `replace`: control how the agent body is applied to the native session prompt |
| `auto-exit` | boolean | Auto-shutdown when the agent finishes (see below) |
| `interactive` | boolean | Whether stall/recovery transitions wake the parent (see below) |
| `cwd` | string | Default working directory |
| `disable-model-invocation` | boolean | Hide from `subagents_list`; still spawnable by explicit name |

### session-mode

- `standalone` — fresh session, no lineage link to the caller (default)
- `lineage-only` — fresh session with `parentSession` linkage for discovery/fork UX, but no copied turns
- `fork` — child session seeded with the caller's conversation context

### auto-exit

With `auto-exit: true`, the session shuts down when the agent's turn ends — the agent just writes its final message and stops (there is no "done" tool). The last assistant message becomes the summary returned to the parent. Recommended for all autonomous agents.

Notes:

- **Manual input does not strand an auto-exit sub-agent.** If a human focuses the session, it still closes once that turn completes normally — only an escape/abort leaves it open.
- **Auto-exit is suppressed while work is in flight:** the session parks as `waiting` instead of exiting when an `ask_question` is still unanswered, or when the agent's own child sub-agents are still running (a worker can stop after dispatching children and stays open until the last result returns).

### interactive

Controls whether `stalled`/`recovered` status transitions send a steer message to the parent session. Defaults to the inverse of `auto-exit`: autonomous agents get stall pings; user-driven agents stay quiet (the user is already working in that session — the widget still updates). Set explicitly to override.

## Tool access control

Access is **whitelist-only**. Each native sub-agent session receives only the tools listed in its profile. There is no default toolset and no deny-list — an agent gets exactly what its frontmatter lists. The restriction survives resume via the loadout snapshot.

Spawns must name a known agent at **every** depth. A top-level session may spawn anything discoverable; a sub-agent may only spawn the agents in its `subagent_agents` list (enforced via `PI_SUBAGENT_ALLOWED`). There is no agentless spawn route, so a child can never escalate to a full-toolset profile by omitting its agent.

Extensions can register additional tools for sub-agents at runtime via `registerToolExtension(name, path)` on the `__pi_interactive_subagents` process global.

## Role folders

`cwd` starts a sub-agent in a directory with its own config, so role-specific setups (agent instructions, skills, extensions) apply:

```
project/
└── agents/
    ├── game-designer/   ← agent instructions, .pi/…
    └── sre/             ← agent instructions, .pi/…
```

```typescript
subagent({ agent: "worker", cwd: "agents/sre", task: "Review the deployment pipeline" });
```

Set a per-agent default with `cwd:` in frontmatter.

## Status widget & configuration

The widget tracks each sub-agent from a runtime activity snapshot written by the child: `starting`, `active` (turn/provider/tool work), `waiting` (open for input or another stage), `stalled` (no valid snapshot for too long), or `running` (fallback). Sub-agent sessions also show their own tools widget — toggle it with `Ctrl+Alt+O`. Completion messages expand with `Ctrl+O`.

Status display is configured via `config.json` in the extension directory (copy `config.json.example`; it's gitignored):

```json
{
  "status": { "enabled": true }
}
```

## Requirements

- [pi](https://github.com/badlogic/pi-mono)
- pi running in its normal terminal session

## Acknowledgements

Forked from [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents), which originated the subagent architecture and status widget; its supervision features were inspired by [RepoPrompt](https://repoprompt.com/).

## License

MIT
