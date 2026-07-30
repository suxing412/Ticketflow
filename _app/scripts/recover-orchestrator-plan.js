// 从失败 Orchestrator 已保存的结构化计划恢复子工单，不再次调用 Provider。
const fs = require('fs');
const path = require('path');
const config = require('../lib/core/config');
const store = require('../lib/core/store');
const orchestration = require('../lib/orchestration/plan');
const lifecycle = require('../lib/lifecycle');
const worktrees = require('../lib/workspace/worktree');

const root = path.resolve(process.argv[2] || '');
const id = String(process.argv[3] || '').trim();
if (!root || !id) throw new Error('用法：node scripts/recover-orchestrator-plan.js <STUDIO_ROOT> <工单号>');
const cfg = config.load(root);
const ticket = store.find(root, id);
if (!ticket) throw new Error(`工单不存在：${id}`);
if (ticket.state !== '执行失败') throw new Error(`工单不在执行失败：${ticket.state}`);
const workspacePath = ticket.fm.workspace && ticket.fm.workspace.path;
const rawPath = path.join(root, '回执', `${id}.provider-output.md`);
const raw = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf8') : '';
const resolved = orchestration.resolvePlan(cfg, raw, workspacePath);
let parent = ticket;
if (ticket.fm.workspace && ticket.fm.workspace.isolated) {
  const checkpoint = worktrees.checkpoint(cfg, ticket.fm.workspace, ticket);
  const workspace = { ...ticket.fm.workspace, ...checkpoint, commit: checkpoint.commit || ticket.fm.workspace.commit, completedAt: new Date().toISOString() };
  store.update(root, id, (fm) => { fm.workspace = workspace; });
  parent = store.find(root, id);
}
const planned = { ...resolved, ...orchestration.materialize(root, cfg, parent, resolved.plan) };
const receipt = raw || `# Orchestrator 计划恢复 ${id}\n\n结构化计划来源：${planned.source}\n\n子工单：${planned.children.join('、')}\n`;
const moved = lifecycle.恢复计划产出(root, id, receipt);
if (!moved.ok) throw new Error(moved.error);
process.stdout.write(JSON.stringify({ ok: true, id, source: planned.source, children: planned.children }, null, 2) + '\n');
