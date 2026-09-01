'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const 输出 = require('../lib/输出提取');
const router = require('../lib/routing/router');
const 派单 = require('../lib/派单');

let passed = 0; const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
console.log('OpenCode / GLM 契约测试');
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'opencode', name), 'utf8');

t('真实成功流：只取最后一个已结束正文，reason=stop 才完整', () => {
  const raw = fixture('success.jsonl');
  assert.equal(输出.抽正文(raw, 'opencode-jsonl').正文, 'CONTRACT_OK');
  assert.equal(输出.抽收尾(raw, 'opencode-jsonl').完整, true);
});

t('真实 401 / 429 顶层 error 分清认证与限流', () => {
  const auth = 输出.抽收尾(fixture('auth-failure.jsonl'), 'opencode-jsonl');
  const rate = 输出.抽收尾(fixture('rate-limit.jsonl'), 'opencode-jsonl');
  assert.equal(auth.api状态, 401); assert.match(输出.收尾说因(auth), /认证失败/);
  assert.equal(rate.api状态, 429); assert.match(输出.收尾说因(rate), /限流|额度用尽/);
});

t('真实中断流没有 reason=stop，不得按成功', () => {
  const end = 输出.抽收尾(fixture('interrupted-stream.jsonl'), 'opencode-jsonl');
  assert.equal(end.完整, false); assert.equal(end.是错, true);
});

t('正文写着「结论：通过」但停在 tool-calls，终态仍不完整', () => {
  const 流 = [
    { type: 'text', part: { type: 'text', text: '结论：通过，未发现阻断问题。', time: { start: 1, end: 2 } } },
    { type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls' } },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.equal(输出.抽正文(流, 'opencode-jsonl').正文, '结论：通过，未发现阻断问题。');
  const end = 输出.抽收尾(流, 'opencode-jsonl');
  assert.equal(end.完整, false); assert.equal(end.是错, true); assert.equal(end.终因, 'tool-calls');
});

t('真实 bash 成功不是进程故障；命令不存在是全灭', () => {
  assert.equal(输出.抽进程故障(fixture('bash-success.jsonl'), '', 'opencode-jsonl'), null);
  const bad = 输出.抽进程故障(fixture('create-process-failure.jsonl'), '', 'opencode-jsonl');
  assert.equal(bad.全灭, true); assert.equal(bad.起不来, 1);
});

t('真实 EPERM 只从 tool_use 取，不把 agent 正文当证据', () => {
  const area = 'D:\\Ticketflow\\apps\\platform\\journal\\opencode-probe';
  const blocked = 输出.抽写权阻断(fixture('eperm.jsonl'), area, 'opencode-jsonl');
  assert.equal(blocked.次数, 1); assert.equal(blocked.区内, 1);
  const quoted = JSON.stringify({ type: 'text', part: { type: 'text', text: "EPERM: operation not permitted, unlink '" + area + "\\x'", time: { end: 2 } } });
  assert.equal(输出.抽写权阻断(quoted, area, 'opencode-jsonl'), null);
});

const ids = {
  glm: { adapter: 'opencode-cli', enabled: true, roles: ['backend'], model: 'zhipuai-coding-plan/glm-5.3', identity: { modelVendor: 'zhipu', harness: 'opencode', authRealm: 'zhipuai-coding-plan', reviewDomain: 'zhipu-glm' } },
  glmAlias: { adapter: 'opencode-cli', enabled: true, roles: ['reviewer'], model: 'zhipuai-coding-plan/glm-5.3-flash', identity: { modelVendor: 'zhipu', harness: 'opencode', authRealm: 'zhipuai-coding-plan', reviewDomain: 'zhipu-glm' } },
  codex: { adapter: 'codex-cli', enabled: true, roles: ['reviewer'], identity: { modelVendor: 'openai', harness: 'codex', authRealm: 'openai-codex', reviewDomain: 'openai-codex' } },
};

t('跨厂按身份域判断：别名同源=false，缺身份=未核验', () => {
  assert.equal(router.isCrossReview(ids.glm.identity, ids.glmAlias.identity), false);
  assert.equal(router.isCrossReview(ids.glm.identity, ids.codex.identity), true);
  assert.equal(router.isCrossReview(ids.glm.identity, null), '未核验');
});

t('评审候选避开同 reviewDomain，执行身份快照不受事后配置别名影响', () => {
  const cfg = { providers: ids, routing: { crossProviderReview: true, roles: { reviewer: { allow: ['glmAlias', 'codex'], prefer: ['glmAlias', 'codex'] } } } };
  const ranked = router.rankProviders(null, cfg, { role: 'reviewer', kind: '评审', task: { fm: { 执行池: 'glm', 执行身份: ids.glm.identity } } });
  assert.equal(ranked[0].name, 'codex');
});

t('落单冻结真实执行身份', () => {
  const ticket = { state: '待投', fm: {} };
  const store = { find: () => ticket, move: (_r, _id, _from, to, mutate) => { mutate(ticket.fm); ticket.state = to; return { ok: true }; } };
  const result = 派单.落单(store, '.', 'T-1', { 选中: 'glm', 身份: ids.glm.identity, 权限: { 模式: '放开' } });
  assert.equal(result.ok, true); assert.equal(ticket.fm.执行身份.reviewDomain, 'zhipu-glm');
});

t('OpenCode 受限角色明确使用 plan agent', () => {
  assert.deepEqual(派单.权限参数({ 执行: { 权限: { 放开: [] } } }, 'reviewer', 'opencode-cli').参数, ['--agent', 'plan']);
});

console.log(`全部通过：${passed} 项`);
