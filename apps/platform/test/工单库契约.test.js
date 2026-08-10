// 工单库契约测试（协-001）
//
// 重点在**反向验证**：工单库让 server 进程有了往仓库之外写文件的能力，
// 这和 git 能力是同一量级的东西。所以「能正常建单」只是及格线，
// 真正要钉住的是「越界能不能被拦下」。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const 平台根 = path.resolve(__dirname, '..');
const 库 = require(path.join(平台根, 'lib', '工单库.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const ta = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('工单库契约测试');

// 临时工单库根，测完删干净。不碰真实私仓。
const 沙盒 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-tickets-'));
库.建目录(沙盒);

// ---- 状态机 ----
t('四态与转移表（协-001 决定 1：先做四态）', () => {
  assert.deepEqual(库.STATES, ['草稿', '待投', '在途', '完成']);
  assert.equal(库.isLegal('草稿', '待投'), true);
  assert.equal(库.isLegal('在途', '待投'), true, '退回重投要合法');
  assert.equal(库.isLegal('草稿', '完成'), false, '不许跳级');
  assert.equal(库.isLegal('完成', '在途'), false, '完成是终态');
});

// ---- 反向验证 ①：工单号 ----
t('工单号白名单挡住穿越与设备名', () => {
  for (const 坏 of ['../../evil', '..', '.hidden', 'a/b', 'a\\b', '', 'CON', 'com1', 'x'.repeat(65)]) {
    assert.ok(库.校验编号(坏), `应被拒但通过了：${JSON.stringify(坏)}`);
  }
  for (const 好 of ['T-1', 'T-1-2', 'abc.def', 'A_9', 'x'.repeat(64)]) {
    assert.equal(库.校验编号(好), null, `应通过但被拒：${好}`);
  }
});

t('穿越编号在 create/find/move 三处都进不去', () => {
  const r = 库.create(沙盒, '../../evil', {}, '');
  assert.equal(r.ok, false);
  assert.ok(/编号非法/.test(r.error), r.error);
  assert.equal(库.find(沙盒, '../../evil'), null, 'find 也不能被穿越编号带出去');
  const m = 库.move(沙盒, '../../evil', '草稿', '待投');
  assert.equal(m.ok, false);
  // 确认沙盒之外没被写出任何东西
  assert.ok(!fs.existsSync(path.resolve(沙盒, '..', '..', 'evil.md')), '仓外不得出现文件');
});

// ---- 反向验证 ②：未配置不兜底 ----
t('未配置根目录时明确报错，不猜路径不建默认目录', () => {
  const 存 = process.env.PLATFORM_TICKETS;
  delete process.env.PLATFORM_TICKETS;
  const 空平台 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-empty-'));
  try {
    const r = 库.解析根目录(空平台);
    assert.equal(r.ok, false);
    assert.ok(/未配置/.test(r.错误), r.错误);
    assert.ok(/PLATFORM_TICKETS/.test(r.错误), '要给出两条修法之一');
    assert.ok(/\.local\.json/.test(r.错误), '要说明配置不会入库');
    assert.deepEqual(fs.readdirSync(空平台), [], '报错路径上不得顺手建任何目录');
  } finally {
    if (存) process.env.PLATFORM_TICKETS = 存;
    fs.rmSync(空平台, { recursive: true, force: true });
  }
});

t('环境变量优先于配置文件', () => {
  const 存 = process.env.PLATFORM_TICKETS;
  process.env.PLATFORM_TICKETS = 沙盒;
  try {
    const r = 库.解析根目录(平台根);
    assert.equal(r.ok, true);
    assert.equal(path.resolve(r.根), path.resolve(沙盒));
    assert.ok(/PLATFORM_TICKETS/.test(r.来源));
  } finally {
    if (存) process.env.PLATFORM_TICKETS = 存; else delete process.env.PLATFORM_TICKETS;
  }
});

// ---- 序列化往返 ----
t('JSON frontmatter 往返精确，嵌套对象与数组不丢', () => {
  // 这正是不手搓 YAML 的原因：plan.js 往 fm 里写 routing、计划生成 都是嵌套结构
  const fm = {
    id: 'T-9', 依赖: ['a', 'b'],
    routing: { pin: 'claude', 权重: { quality: 0.5 } },
    计划生成: { 子单: ['T-9-1'], 摘要: '含"引号"与\n换行' },
    空值: null, 略过: undefined,
  };
  const 文本 = 库.序列化(fm, '## 正文\n带 --- 分隔线的内容');
  const 临 = path.join(沙盒, '_往返.md');
  fs.writeFileSync(临, 文本, 'utf8');
  const 回 = 库.解析(临);
  assert.equal(回.坏帧, false);
  assert.deepEqual(回.fm.依赖, ['a', 'b']);
  assert.deepEqual(回.fm.routing, { pin: 'claude', 权重: { quality: 0.5 } });
  assert.equal(回.fm.计划生成.摘要, '含"引号"与\n换行');
  assert.equal(回.fm.空值, null);
  assert.ok(!('略过' in 回.fm), 'undefined 字段应被剔除');
  assert.ok(回.正文.includes('带 --- 分隔线的内容'), '正文里的分隔线不该截断解析');
  fs.rmSync(临);
});

// ---- 正常流转 ----
t('建单 → 流转 → 非法转移被拒', () => {
  const c = 库.create(沙盒, 'T-1', { id: 'T-1', title: '第一张' }, '## 范围\n试跑');
  assert.equal(c.ok, true);
  assert.equal(c.state, '草稿');
  assert.equal(库.create(沙盒, 'T-1', {}, '').ok, false, '重复编号必须拒');

  const 跳 = 库.move(沙盒, 'T-1', '草稿', '完成');
  assert.equal(跳.ok, false);
  assert.ok(/不合法的转移/.test(跳.error) && /待投/.test(跳.error), '错误要写明合法去向：' + 跳.error);

  assert.equal(库.move(沙盒, 'T-1', '草稿', '待投').ok, true);
  assert.equal(库.find(沙盒, 'T-1').state, '待投');
  assert.equal(库.move(沙盒, 'T-1', '待投', '在途').ok, true);
  assert.equal(库.move(沙盒, 'T-1', '在途', '待投').ok, true, '退回重投');
  assert.equal(库.move(沙盒, 'T-1', '待投', '在途').ok, true);
  assert.equal(库.move(沙盒, 'T-1', '在途', '完成').ok, true);
  assert.equal(库.find(沙盒, 'T-1').state, '完成');

  const 源缺 = 库.move(沙盒, 'T-1', '草稿', '待投');
  assert.equal(源缺.ok, false);
  assert.ok(/源不存在/.test(源缺.error), 源缺.error);
});

t('update 改 fm 与正文，且刷新更新时间', () => {
  库.create(沙盒, 'T-2', { id: 'T-2', 优先级: 'P2' }, '旧正文');
  const r = 库.update(沙盒, 'T-2', (fm) => { fm.优先级 = 'P0'; return { body: '新正文' }; });
  assert.equal(r.ok, true);
  const t2 = 库.find(沙盒, 'T-2');
  assert.equal(t2.fm.优先级, 'P0');
  assert.equal(t2.body.trim(), '新正文');
  assert.ok(t2.fm.更新时间, '应写入更新时间');
  assert.equal(库.update(沙盒, '不存在的单', () => {}).ok, false);
});

t('list 可按状态过滤', () => {
  const 全 = 库.list(沙盒);
  assert.ok(全.length >= 2);
  const 完成 = 库.list(沙盒, '完成');
  assert.ok(完成.every((x) => x.state === '完成'));
  assert.ok(完成.some((x) => x.id === 'T-1'));
});

// ---- plan.js 注入契约 ----
t('本库满足 plan.js 的注入要求（find/create/move/update 四件齐备）', () => {
  const 计划 = require(path.join(平台根, 'lib', 'orchestration', 'plan.js'));
  // materialize 只在缺 store 时抛错；喂本库应当不再抛「需要注入」
  assert.doesNotThrow(() => {
    try { 计划.materialize(沙盒, {}, { id: 'T-1', fm: {} }, { tasks: [] }, 库); }
    catch (e) {
      assert.ok(!/需要注入/.test(e.message), '本库应被认作合法 store：' + e.message);
      throw e;
    }
  });
});

// ---- 接口层端到端 ----
const 门禁令牌 = () => JSON.parse(fs.readFileSync(path.join(平台根, 'config', '接口令牌.local.json'), 'utf8')).令牌;

const 探端口 = () => new Promise((resolve, reject) => {
  const p = require('net').createServer();
  p.once('error', reject);
  p.listen(0, '127.0.0.1', () => { const n = p.address().port; p.close(() => resolve(n)); });
});

const 起服务 = async () => {
  const port = await 探端口();
  const env = { ...process.env, PORT: String(port), PLATFORM_TICKETS: 沙盒 };
  const srv = require('child_process').spawn(process.execPath, [path.join(平台根, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const 超时 = setTimeout(() => reject(new Error('server 起不来')), 10000);
    srv.stdout.on('data', (d) => { if (String(d).includes('开机')) { clearTimeout(超时); resolve(); } });
    srv.on('error', reject);
  });
  return { srv, port };
};

const 取 = (port, 路径, 选项 = {}) => new Promise((resolve, reject) => {
  const 头 = { Authorization: 'Bearer ' + 门禁令牌(), ...(选项.体 ? { 'Content-Type': 'application/json' } : {}) };
  const req = http.request({ host: '127.0.0.1', port, path: 路径, method: 选项.method || 'GET', headers: 头 }, (res) => {
    let s = ''; res.on('data', (d) => s += d);
    res.on('end', () => { try { resolve({ 码: res.statusCode, 体: JSON.parse(s) }); } catch (e) { reject(new Error('非 JSON：' + s.slice(0, 200))); } });
  });
  req.on('error', reject);
  if (选项.体) req.write(JSON.stringify(选项.体));
  req.end();
});

(async () => {
  const { srv, port } = await 起服务();
  try {
    await ta('GET /api/tickets 列单，未知状态被拒', async () => {
      const r = await 取(port, '/api/tickets');
      assert.equal(r.码, 200);
      assert.ok(r.体.条数 >= 2);
      const 坏 = await 取(port, '/api/tickets?state=' + encodeURIComponent('不存在的态'));
      assert.equal(坏.码, 400);
      assert.ok(/合法/.test(坏.体.error), 坏.体.error);
    });

    await ta('POST /api/tickets 建单，穿越编号被拒且仓外无文件', async () => {
      const r = await 取(port, '/api/tickets', { method: 'POST', 体: { id: 'API-1', fm: { title: '经接口建的' } } });
      assert.equal(r.码, 201);
      assert.equal(r.体.state, '草稿');
      const 坏 = await 取(port, '/api/tickets', { method: 'POST', 体: { id: '../../evil' } });
      assert.equal(坏.码, 400);
      assert.ok(/编号非法/.test(坏.体.error), 坏.体.error);
      assert.ok(!fs.existsSync(path.resolve(沙盒, '..', '..', 'evil.md')));
    });

    await ta('POST /api/tickets/:id/move 非法转移 409 并说明合法去向', async () => {
      const 坏 = await 取(port, '/api/tickets/API-1/move', { method: 'POST', 体: { 到: '完成' } });
      assert.equal(坏.码, 409);
      assert.ok(/待投/.test(坏.体.error), '要写明合法去向：' + 坏.体.error);
      const 好 = await 取(port, '/api/tickets/API-1/move', { method: 'POST', 体: { 到: '待投' } });
      assert.equal(好.码, 200);
      const 查 = await 取(port, '/api/tickets/API-1');
      assert.equal(查.体.状态, '待投');
    });

    await ta('POST /api/plan/materialize 落盘子单并幂等', async () => {
      await 取(port, '/api/tickets', { method: 'POST', 体: { id: 'P-1', fm: { id: 'P-1', title: '父单', 项目: 'demo' } } });
      const 输出 = ['```json', JSON.stringify({
        summary: '两步走',
        tasks: [
          { key: 'a', title: '写接口', role: 'backend', acceptance: ['返回 200'] },
          { key: 'b', title: '评审', role: 'reviewer', dependsOn: ['a'], acceptance: ['无阻断'] },
        ],
      }), '```'].join('\n');

      const r = await 取(port, '/api/plan/materialize', { method: 'POST', 体: { 输出, 父单: 'P-1' } });
      assert.equal(r.码, 200, JSON.stringify(r.体));
      assert.equal(r.体.新建.length, 2, '应新建两张子单');
      // 子单落草稿后应已自动迁到待投
      const 子 = await 取(port, '/api/tickets/' + r.体.子单[0]);
      assert.equal(子.体.状态, '待投');
      assert.equal(子.体.fm.父单, 'P-1');
      // 父单写入计划生成
      const 父 = await 取(port, '/api/tickets/P-1');
      assert.deepEqual(父.体.fm.计划生成.子单, r.体.子单);

      // 幂等：再喂一次同样的计划，不该重复新建
      const 再 = await 取(port, '/api/plan/materialize', { method: 'POST', 体: { 输出, 父单: 'P-1' } });
      assert.equal(再.码, 200);
      assert.equal(再.体.新建.length, 0, '重复物化不得重复新建');
      assert.equal(再.体.更新.length, 2, '待投态的子单应走更新');
    });

    await ta('父单不存在时 404，不是 500', async () => {
      const r = await 取(port, '/api/plan/materialize', { method: 'POST', 体: { 输出: '{}', 父单: '没这单' } });
      assert.equal(r.码, 404);
    });

    await ta('工单接口同样受门禁保护', async () => {
      const r = await new Promise((resolve, reject) => {
        const q = http.request({ host: '127.0.0.1', port, path: '/api/tickets', method: 'GET' }, (res) => {
          let s = ''; res.on('data', (d) => s += d); res.on('end', () => resolve({ 码: res.statusCode }));
        });
        q.on('error', reject); q.end();
      });
      assert.equal(r.码, 401);
    });

    console.log(`全部通过：${passed} 项`);
  } finally {
    srv.kill();
    fs.rmSync(沙盒, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); try { fs.rmSync(沙盒, { recursive: true, force: true }); } catch { /* 已清 */ } process.exit(1); });
