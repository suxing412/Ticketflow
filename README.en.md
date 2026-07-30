# Producer Console (监制台)

**A cockpit that hands your production pipeline to a fleet of AI agents.**
You do exactly three things — release tickets into the pool, arbitrate disputes, and give final
taste approval. Drafting assistance, claiming, execution, QA review, delegated acceptance,
failure triage, bookkeeping and notifications are all automatic.

> V2 is underway: roles are decoupled from model vendors and routed dynamically across enabled
> providers. New installations default to Orchestrator, Backend, Frontend, Reviewer, and Integrator;
> the original game-studio workflow remains available as a compatibility profile. Structured DAG
> planning, per-ticket Git worktrees, checkpoint commits, and dependency-aware integration are wired end to end.

[中文文档（主）](README.md) · [Setup Guide](套件/SETUP.md) · [Design & Protocol](docs/设计与协议.md)

## ⚠️ Read before use (security disclosure)

1. **In live-fire mode, agents retain local-process access to the repos you register.** Git projects
   use a separate worktree and branch per ticket to prevent concurrent agents from overwriting one
   another, but this is not a security sandbox. The runner
   spawns headless CLIs (`codex exec --dangerously-bypass-approvals-and-sandbox`,
   `claude -p --permission-mode acceptEdits`) with cwd set to the isolated worktree (or the project
   directory when Git isolation is unavailable). Register only
   repos you are willing to let agents modify, and keep git history for rollback. Live fire is
   **locked by default**; unlocking is an explicit, confirmed action.
2. **This tool reads and writes your CLI credential files**: it reads
   `~/.claude/.credentials.json` to display subscription quota and refreshes the token when
   expired (same OAuth flow as the official CLI, result written back). It reads
   `~/.codex/config.toml` for model detection. Credentials never leave your machine.
3. **Auto-bookkeeping**: if the install directory is inside a git repo, ticket flow is
   auto-committed every 10 minutes (commit only, never push; can be disabled).
4. Dry-run mode (default) makes zero AI calls and costs nothing — safe to explore the full flow.

## Quick start

1. Download `监制台-套件-vX.Y.Z.zip` from [Releases](../../releases) and extract
2. Run **部署.bat** (deploy): pick a directory → optionally register your first project repo → launches automatically
3. **The only acceptance criterion: the "环境" (environment) light on the overview page reads 就绪 (Ready).**
   Behind it is a four-group full-pipeline self-check; degraded/blocked states list concrete fixes per item.

Prerequisites: Windows 10/11, codex CLI, Claude Code CLI (logged in), and a proxy if your
network needs one (auto-resolved and injected at boot).

## Concepts in 30 seconds

- **Directories are the state machine**: a ticket is a plaintext .md living in one of ten state
  folders; changing state = an atomic rename. Plaintext is the single source of truth.
- **Pull model**: agents auto-claim the next ticket when free; headcount = concurrency cap.
- **Dynamic providers**: roles are independent from vendors; capability and recent reviewed quality
  determine which enabled provider handles each new ticket.
- **DAG + worktrees**: validated Orchestrator plans become dependent tickets, each executed on an
  isolated branch; Integrator merges their checkpoints before publication.
- **Two gates**: a manual pause gate plus automatic quota locks per CLI pool.
- **Model tiering**: cheap models do the labor, expensive models sit as judges (QA review /
  delegated acceptance).
- **Failure lane**: crashed/timed-out tickets land in a dedicated triage state — nothing hangs.
- **Curated style library**: accepted gems are manually distilled into axioms agents read before working.

Full configuration reference (every `studio.config.json` field, with its in-app location) is in
the [Chinese README](README.md#配置详情studioconfigjson-全字段) — the table is language-neutral.

## Known limitations

Windows-only; subscription quota endpoint is account-rate-limited (readings refresh on a ≥5-min
discipline with timestamps); no auto-update (re-run deploy to upgrade); the art role ships specs
and placeholders (no image generation integration yet).

## License

MIT © 2026 suxing412
