// dependency-cycle.test.js — TK-188：未收口工单依赖图、环路径与起草期阻断。
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cycle = require('../lib/dependency-cycle');
const brain = require('../lib/pm/brain');
const store = require('../lib/core/store');
const inbox = require('../lib/inbox');

let passed = 0;
function t(name, fn) { fn(); passed += 1; console.log('  ✓ ' + name); }
function ticket(id, 依赖) { return { id, fm: 依赖 === undefined ? {} : { 依赖 } }; }
function paths(report) { return report.cycles.map((path) => path.join(' → ')); }

console.log('dependency-cycle 依赖成环测试');

t('自环：检出首尾闭合路径但按 H61 不阻断', () => {
  const report = cycle.analyzeTickets([ticket('TK-1', 'TK-1')]);
  assert.deepEqual(paths(report), ['TK-1 → TK-1']);
  assert.equal(report.anomalies.self.length, 1);
  assert.equal(report.blockingCycles.length, 0);
});

t('二元环：TK 与施工令编号归一后检出', () => {
  const report = cycle.analyzeTickets([ticket('TK-1', '施工令-2'), ticket('TK-2', 'TK-1')]);
  assert.deepEqual(paths(report), ['TK-1 → TK-2 → TK-1']);
});

t('三元长环：返回完整有序闭合路径', () => {
  const report = cycle.analyzeTickets([
    ticket('TK-1', 'TK-2'), ticket('TK-2', 'TK-3'), ticket('TK-3', 'TK-1'),
  ]);
  assert.deepEqual(paths(report), ['TK-1 → TK-2 → TK-3 → TK-1']);
});

t('多环并存：全部独立环都返回', () => {
  const report = cycle.analyzeTickets([
    ticket('TK-1', 'TK-2'), ticket('TK-2', 'TK-1'),
    ticket('TK-3', 'TK-4'), ticket('TK-4', 'TK-3'),
  ]);
  assert.deepEqual(paths(report), ['TK-1 → TK-2 → TK-1', 'TK-3 → TK-4 → TK-3']);
});

t('无环大图：240 节点、多分隔符，零命中', () => {
  const tickets = [];
  for (let i = 1; i <= 240; i += 1) {
    const dep = i <= 1 ? '' : (i % 3 === 0 ? `TK-${i - 1}；TK-${i - 2}` : `TK-${i - 1}`);
    tickets.push(ticket(`TK-${i}`, dep));
  }
  const report = cycle.analyzeTickets(tickets);
  assert.equal(report.cycles.length, 0);
  assert.equal(report.blockingCycles.length, 0);
});

t('不存在依赖：异常边上报，不参与成环', () => {
  const report = cycle.analyzeTickets([ticket('TK-1', 'TK-404')]);
  assert.equal(report.anomalies.missing.length, 1);
  assert.equal(report.anomalies.missing[0].to, 'TK-404');
  assert.equal(report.cycles.length, 0);
});

t('空或缺失依赖字段：不造边、不报异常', () => {
  const report = cycle.analyzeTickets([ticket('TK-1', ''), ticket('TK-2')]);
  assert.equal(report.edges.length, 0);
  assert.equal(report.anomalies.missing.length + report.anomalies.self.length, 0);
});

t('起草期挂钩：试落盘单成环即阻断、发急件且未入库', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk188-'));
  try {
    assert.equal(store.create(root, 'TK-1', { id: 'TK-1', 依赖: 'TK-2' }, '既有单').ok, true);
    const result = brain.起草依赖闸(root, {
      id: 'TK-2', fm: { id: 'TK-2', 依赖: '施工令-1' }, body: '试落盘单',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /环路径: TK-1 → TK-2 → TK-1/);
    assert.equal(store.find(root, 'TK-2'), null, '闸只预检，不会写入试落盘单');
    assert.match(result.urgent, /环路径: TK-1 → TK-2 → TK-1/);
    assert.match(result.urgent, /TK-1 的 `依赖:` 字段写入「TK-2」/);
    assert.match(result.urgent, /建议断点:/);
    const alert = inbox.list(root, Infinity).at(-1);
    assert.equal(alert.级别, '急');
    assert.equal(alert.类型, '依赖成环');
    assert.equal(alert.正文, result.urgent, '既有急件通道保留完整正文');
    assert.equal(cycle.openTickets(root).length, 1, '试验结束时仅有既有单');
    process.stdout.write(result.error + '\n');
    process.stdout.write(result.urgent + '\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('/api/draft：与既有单成真环时 400 阻断、无落盘且不写 journal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk188-api-'));
  try {
    store.ensureDirs(root);
    fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify({}), 'utf8');
    assert.equal(store.create(root, 'TK-1', { id: 'TK-1', 依赖: 'TK-2' }, '既有单').ok, true);
    const serverPath = path.join(__dirname, '..', 'server.js');
    const storePath = path.join(__dirname, '..', 'lib', 'core', 'store.js');
    const code = `
      const fs = require('fs');
      const path = require('path');
      const studio = require(${JSON.stringify(serverPath)});
      const store = require(${JSON.stringify(storePath)});
      const root = process.env.STUDIO_ROOT;
      const journal = () => {
        const dir = path.join(root, 'journal');
        return fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]) : [];
      };
      studio.start().then(async ({ server, initError }) => {
        if (initError) throw new Error(initError);
        const before = journal();
        const response = await fetch('http://127.0.0.1:' + process.env.STUDIO_PORT + '/api/draft', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'TK-2', title: '试落盘单', 依赖: '施工令-1' }),
        });
        const body = await response.json();
        const count = store.STATES.reduce((n, state) => n + store.list(root, state).length, 0);
        const result = { status: response.status, body, exists: !!store.find(root, 'TK-2'), count, journalChanged: JSON.stringify(before) !== JSON.stringify(journal()) };
        server.close(() => { process.stdout.write('@@' + JSON.stringify(result) + '@@'); process.exit(0); });
      }).catch((error) => { process.stdout.write('@@' + JSON.stringify({ error: error.message }) + '@@'); process.exit(1); });`;
    const raw = execFileSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: '4959', STUDIO_STUB: '1' },
    });
    const result = JSON.parse((raw.match(/@@([\s\S]*?)@@/) || [])[1] || '{}');
    assert.equal(result.status, 400, JSON.stringify(result));
    assert.match(String(result.body && result.body.error), /环路径: TK-1 → TK-2 → TK-1/);
    assert.equal(result.exists, false, '命中真环不得写入试落盘单');
    assert.equal(result.count, 1, '单库单数必须保持既有单的 1 张');
    assert.equal(result.journalChanged, false, '被阻断的 /api/draft 不得写 journal');
    process.stdout.write(JSON.stringify(result.body) + '\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

t('/api/draft：异常边随成功响应单独上报且不阻断', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk188-api-anomaly-'));
  try {
    store.ensureDirs(root);
    fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify({}), 'utf8');
    assert.equal(store.create(root, 'TK-1', { id: 'TK-1', 依赖: 'TK-404' }, '既有单').ok, true);
    const serverPath = path.join(__dirname, '..', 'server.js');
    const storePath = path.join(__dirname, '..', 'lib', 'core', 'store.js');
    const code = `
      const studio = require(${JSON.stringify(serverPath)});
      const store = require(${JSON.stringify(storePath)});
      const root = process.env.STUDIO_ROOT;
      studio.start().then(async ({ server, initError }) => {
        if (initError) throw new Error(initError);
        const response = await fetch('http://127.0.0.1:' + process.env.STUDIO_PORT + '/api/draft', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'TK-2', title: '异常边样张' }),
        });
        const body = await response.json();
        const result = { status: response.status, body, exists: !!store.find(root, 'TK-2') };
        server.close(() => { process.stdout.write('@@' + JSON.stringify(result) + '@@'); process.exit(0); });
      }).catch((error) => { process.stdout.write('@@' + JSON.stringify({ error: error.message }) + '@@'); process.exit(1); });`;
    const raw = execFileSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: '4960', STUDIO_STUB: '1' },
    });
    const result = JSON.parse((raw.match(/@@([\s\S]*?)@@/) || [])[1] || '{}');
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.exists, true, '异常边不阻断试落盘单');
    assert.equal(result.body.依赖异常.missing.length, 1);
    assert.deepEqual(result.body.依赖异常.missing[0].from, 'TK-1');
    assert.deepEqual(result.body.依赖异常.missing[0].to, 'TK-404');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log('全部通过：' + passed + ' 项');
console.log(`用例总数 ${passed} / 通过 ${passed} / 失败 0`);
