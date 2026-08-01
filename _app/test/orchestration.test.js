// orchestration.test.js — Orchestrator JSON 协议、DAG 校验和待投子单物化。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const plan = require('../lib/orchestration/plan');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

const CFG = {
  roles: { orchestrator: {}, backend: {}, frontend: {}, reviewer: {}, integrator: {} },
  职能: ['orchestrator', 'backend', 'frontend', 'reviewer', 'integrator'],
  orchestration: { maxTasks: 10 },
};
const SAMPLE = {
  summary: '接口优先，前后端并行',
  tasks: [
    { key: 'contract', title: '定义接口契约', role: 'backend', writeScope: ['contracts/**'], acceptance: ['契约可被解析'] },
    { key: 'server', title: '实现后端', role: 'backend', dependsOn: ['contract'], writeScope: ['server/**'], acceptance: ['后端测试通过'] },
    { key: 'web', title: '实现前端', role: 'frontend', dependsOn: ['contract'], writeScope: ['web/**'], acceptance: ['前端测试通过'] },
    { key: 'join', title: '集成验证', role: 'integrator', dependsOn: ['server', 'web'], acceptance: ['全量测试通过'] },
  ],
};

let passed = 0; const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
console.log('orchestration Orchestrator 计划测试');

t('可从带说明的 JSON 代码块提取计划', () => {
  const parsed = plan.extractJson(`方案如下：\n\`\`\`json\n${JSON.stringify(SAMPLE)}\n\`\`\``);
  assert.equal(parsed.tasks.length, 4);
});

t('最终回复缺少 JSON 时从固定计划文件恢复', () => {
  const workspace = makeRoot();
  const file = path.join(workspace, '.studio', 'plan.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(SAMPLE), 'utf8');
  const resolved = plan.resolvePlan(CFG, '计划文档已经写好，详见仓库。', workspace);
  assert.equal(resolved.source, '.studio/plan.json');
  assert.equal(resolved.plan.tasks.length, 4);
});

t('DAG 校验拒绝未知角色、未知依赖、递归 Orchestrator 和环', () => {
  assert.throws(() => plan.normalizePlan(CFG, { tasks: [{ key: 'x', title: 'x', role: 'missing', acceptance: ['ok'] }] }), /未知角色/);
  assert.throws(() => plan.normalizePlan(CFG, { tasks: [{ key: 'x', title: 'x', role: 'backend', dependsOn: ['y'], acceptance: ['ok'] }] }), /未知 key/);
  assert.throws(() => plan.normalizePlan(CFG, { tasks: [{ key: 'x', title: 'x', role: 'orchestrator', acceptance: ['ok'] }] }), /递归/);
  const cyclic = { tasks: [
    { key: 'a', title: 'a', role: 'backend', dependsOn: ['b'], acceptance: ['ok'] },
    { key: 'b', title: 'b', role: 'frontend', dependsOn: ['a'], acceptance: ['ok'] },
  ] };
  assert.throws(() => plan.normalizePlan(CFG, cyclic), /成环/);
});

t('reviewer 只读边界拒绝实现目录和编码能力', () => {
  assert.throws(() => plan.normalizePlan(CFG, { tasks: [{
    key: 'review_impl', title: '实现申请评审', role: 'reviewer',
    writeScope: ['server/review/**'], acceptance: ['评审可运行'],
  }] }), /reviewer 是只读角色/);
  assert.throws(() => plan.normalizePlan(CFG, { tasks: [{
    key: 'review_test', title: '编写评测', role: 'reviewer',
    requiredCapabilities: ['coding'], acceptance: ['测试通过'],
  }] }), /reviewer 不能要求编码能力/);
  assert.doesNotThrow(() => plan.normalizePlan(CFG, { tasks: [{
    key: 'qa', title: '只读复核产出', role: 'reviewer',
    requiredCapabilities: ['code-review'], acceptance: ['逐条给出证据'],
  }] }));
});

t('有效计划物化为待投子单，编号和依赖转换稳定', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'REQ-1', role: 'orchestrator', 职能: 'orchestrator', 项目: 'DEMO', 主办: 'orchestrator-A' });
  const parent = store.find(root, 'REQ-1');
  const result = plan.materialize(root, CFG, parent, plan.normalizePlan(CFG, SAMPLE));
  assert.deepEqual(result.children, ['REQ-1-1', 'REQ-1-2', 'REQ-1-3', 'REQ-1-4']);
  assert.equal(store.find(root, 'REQ-1-2').state, '待投');
  assert.deepEqual(store.find(root, 'REQ-1-4').fm.依赖, ['REQ-1', 'REQ-1-2', 'REQ-1-3']);
  assert.deepEqual(store.find(root, 'REQ-1-1').fm.依赖, ['REQ-1'], '子单继承父单检查点和验收门');
  assert.deepEqual(store.find(root, 'REQ-1').fm.计划生成.子单, result.children);
});

t('重规划只更新未开工子单，不覆盖已经在途的子单', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'REQ-2', role: 'orchestrator', 职能: 'orchestrator', 主办: 'orchestrator-A' });
  const normalized = plan.normalizePlan(CFG, SAMPLE);
  plan.materialize(root, CFG, store.find(root, 'REQ-2'), normalized);
  store.move(root, 'REQ-2-1', '待投', '池');
  const next = JSON.parse(JSON.stringify(SAMPLE)); next.tasks[0].title = '不应覆盖';
  const result = plan.materialize(root, CFG, store.find(root, 'REQ-2'), plan.normalizePlan(CFG, next));
  assert.ok(result.retained.includes('REQ-2-1'));
  assert.equal(store.find(root, 'REQ-2-1').fm.title, '定义接口契约');
});

console.log(`全部通过：${passed} 项`);
