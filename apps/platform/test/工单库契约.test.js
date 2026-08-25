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
t('状态机：加态靠改表不改逻辑（协-004 质检、协-009 已归档）', () => {
  // 协-001 决定 1 承诺「表驱动，加态是改表不是改逻辑」。两次加态都兑现了：
  // 状态机代码一行没动，只改了 STATES 与 TRANSITIONS 两张表。
  // 这条 deepEqual 的价值就在于**加一个态不能悄悄发生**——每次都要有人来这里确认。
  assert.deepEqual(库.STATES, ['草稿', '待投', '在途', '质检', '完成', '已归档']);
  assert.equal(库.isLegal('草稿', '待投'), true);
  assert.equal(库.isLegal('在途', '质检'), true, '干完送检');
  assert.equal(库.isLegal('在途', '完成'), true, '免检时直达完成');
  assert.equal(库.isLegal('质检', '完成'), true, '判过');
  assert.equal(库.isLegal('质检', '待投'), true, '判不过回待投重做——不是失败终态，同一张单可以再跑');
  assert.equal(库.isLegal('在途', '待投'), true, '退回重投要合法');
  assert.equal(库.isLegal('草稿', '完成'), false, '不许跳级');
  assert.equal(库.isLegal('草稿', '质检'), false, '没干过的活不能直接送检');
});

t('已归档：任何状态都能归，且归了能取回', () => {
  // 归档是「删掉它」的正规入口。此前工单库**只能建不能销**，
  // 人想清一张废单只能去磁盘 rm 文件——绕过产品，账本还留下对不上号的记录。
  for (const s of ['草稿', '待投', '在途', '质检', '完成']) {
    assert.equal(库.isLegal(s, '已归档'), true, `${s} 该能归档——废单不分状态`);
  }
  // **归档必须可逆**。不可逆的话人不敢用它，只会继续攒着，
  // 那就等于没做这个功能。
  assert.equal(库.isLegal('已归档', '草稿'), true, '取回要合法');
  assert.deepEqual(库.TERMINAL, ['已归档'], '真正的终态只有已归档；完成之后还能归档');
  assert.equal(库.isLegal('完成', '已归档'), true, '完成不是尽头——它还能被收纳');
  assert.equal(库.isLegal('完成', '在途'), false, '但完成不能倒回去重跑');
  assert.equal(库.isLegal('已归档', '在途'), false, '取回只能回草稿，不许从归档直接上线');
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

// ---- 落位（协-005）----
// 「不替你猜位置」原则的另一半：位置仍然人给，但别逼人去翻文档手搓 JSON。
// 这一组要守住的是——**收进来的值必须经得起推敲**，因为它决定业务数据落在哪儿。
t('落位：拒空、拒相对路径、拒装进产品自己的目录', () => {
  const 假平台 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-fake-'));
  try {
    assert.equal(库.落位(假平台, '').ok, false);
    assert.equal(库.落位(假平台, '   ').ok, false);
    // 相对路径的基准是进程工作目录，换个启动方式就指向别处——业务数据不能挂这上面
    const 相对 = 库.落位(假平台, './单');
    assert.equal(相对.ok, false);
    assert.ok(/绝对路径/.test(相对.错误));
    // 装进产品自己目录是真踩过的坑：portable 打包每次解到新临时目录，
    // 工单下次启动就没了，而且不报错——表现成一个空看板，像数据凭空蒸发。
    const 自身 = 库.落位(假平台, path.join(假平台, '单'));
    assert.equal(自身.ok, false);
    assert.ok(/portable|临时目录/.test(自身.错误), '得说清为什么不行，不能只说「不允许」：' + 自身.错误);
  } finally { fs.rmSync(假平台, { recursive: true, force: true }); }
});

t('落位：正常路径建齐五个状态目录，写出的配置能被解析回来', () => {
  const 假平台 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-fake-'));
  const 目标 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-store-'));
  const 存 = process.env.PLATFORM_TICKETS;
  delete process.env.PLATFORM_TICKETS;              // 免得环境变量盖住，测的就不是配置文件了
  try {
    const r = 库.落位(假平台, 目标);
    assert.equal(r.ok, true, r.错误);
    assert.deepEqual(fs.readdirSync(目标).sort(), [...库.STATES].sort());
    // 写完要能读回来——写进去和读出来是两件事，这个仓栽过一次
    const 回 = 库.解析根目录(假平台);
    assert.equal(回.ok, true);
    assert.equal(path.resolve(回.根), path.resolve(目标));
    // 换根要如实上报：不报的话，看板上原来的单看着像凭空消失了
    const 目标2 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-store2-'));
    const r2 = 库.落位(假平台, 目标2);
    assert.equal(r2.换根, true);
    assert.equal(path.resolve(r2.旧根), path.resolve(目标));
    fs.rmSync(目标2, { recursive: true, force: true });
  } finally {
    if (存) process.env.PLATFORM_TICKETS = 存;
    fs.rmSync(假平台, { recursive: true, force: true });
    fs.rmSync(目标, { recursive: true, force: true });
  }
});

t('落位：被 PLATFORM_TICKETS 盖住时必须明说', () => {
  // 配了却不生效，是最难自查的一种「没反应」——它长得跟成功一模一样。
  const 假平台 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-fake-'));
  const 目标 = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-store-'));
  const 存 = process.env.PLATFORM_TICKETS;
  process.env.PLATFORM_TICKETS = 目标;
  try {
    const r = 库.落位(假平台, 目标);
    assert.equal(r.ok, true);
    assert.equal(r.被环境变量盖住, true, '设了环境变量还回 false，人会以为配好了然后对着空看板发懵');
  } finally {
    if (存) process.env.PLATFORM_TICKETS = 存; else delete process.env.PLATFORM_TICKETS;
    fs.rmSync(假平台, { recursive: true, force: true });
    fs.rmSync(目标, { recursive: true, force: true });
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

t('挂起字段保真：状态迁移后字段逐字等值，未知键相对顺序不变', () => {
  const id = 'S-keep';
  const fm = {
    id, title: '保真样例', 未知前: { keep: ['a', 'b'] },
    挂起: { 状态: '挂起', 原因: '等待上游裁决', 开始时间: '2026-08-25T01:02:03.000Z', 操作者: '制作人' },
    未知后: '不可丢失', 未知末: { flag: true },
  };
  const 源 = 库.工单路径(沙盒, '草稿', id);
  fs.writeFileSync(源, 库.序列化(fm, '正文'), 'utf8');
  const 挂起原文 = JSON.stringify(库.解析(源).fm.挂起);
  assert.equal(库.move(沙盒, id, '草稿', '待投').ok, true);
  const 迁后 = 库.find(沙盒, id);
  assert.equal(JSON.stringify(迁后.fm.挂起), 挂起原文, '挂起字段必须逐字等值');
  const 键 = Object.keys(迁后.fm);
  assert.ok(键.indexOf('未知前') < 键.indexOf('挂起') && 键.indexOf('挂起') < 键.indexOf('未知后') && 键.indexOf('未知后') < 键.indexOf('未知末'),
    '未知字段相对顺序必须透传');
});

t('挂起字段保真：原地写回（看板/批量/归档共用入口）不触碰挂起键', () => {
  const 前 = 库.find(沙盒, 'S-keep');
  const 原 = JSON.stringify(前.fm.挂起);
  const r = 库.update(沙盒, 'S-keep', (fm) => { fm.看板标记 = '已阅'; });
  assert.equal(r.ok, true);
  const 后 = 库.find(沙盒, 'S-keep');
  assert.equal(JSON.stringify(后.fm.挂起), 原);
  assert.equal(后.fm.看板标记, '已阅');
});

t('挂起字段只能由显式动作改写：通用 update 不得删除或覆盖', () => {
  const r = 库.update(沙盒, 'S-keep', (fm) => { delete fm.挂起; });
  assert.equal(r.ok, false);
  assert.ok(/显式/.test(r.error));
  assert.ok(库.find(沙盒, 'S-keep').fm.挂起, '被拒后原字段不得丢失');
  assert.equal(库.create(沙盒, 'S-preload', { id: 'S-preload', 挂起: { 状态: '挂起' } }, '' ).ok, false,
    '建单不得绕过挂起动作预置字段');
});

t('显式挂起/复工：只改挂起键，复工后清除且状态不隐式迁移', () => {
  assert.equal(库.create(沙盒, 'S-action', { id: 'S-action', title: '动作样例', 未知键: '保留' }, '正文').ok, true);
  const 挂 = 库.挂起(沙盒, 'S-action', { 原因: '等待外部依赖', 操作者: '制作人', 到期时间: '2026-08-26T00:00:00.000Z' });
  assert.equal(挂.ok, true);
  const 中 = 库.find(沙盒, 'S-action');
  assert.equal(中.state, '草稿', '挂起不改变状态集合');
  assert.equal(中.fm.挂起.原因, '等待外部依赖');
  assert.equal(中.fm.未知键, '保留');
  assert.equal(库.复工(沙盒, 'S-action').ok, true);
  const 后 = 库.find(沙盒, 'S-action');
  assert.equal(后.state, '草稿');
  assert.equal(后.fm.挂起, undefined, '复工是唯一清除时机');
  assert.equal(后.fm.未知键, '保留');
});

t('挂起字段保真：执行器状态迁移入口不清除有效挂起', () => {
  const r = 库.move(沙盒, 'S-keep', '待投', '在途', (fm) => { fm.派单时间 = '2026-08-25T02:00:00.000Z'; });
  assert.equal(r.ok, true);
  const 后 = 库.find(沙盒, 'S-keep');
  assert.equal(后.fm.挂起.原因, '等待上游裁决');
  assert.equal(后.fm.派单时间, '2026-08-25T02:00:00.000Z');
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

    await ta('GET /api/tickets 默认不含已归档，显式要才给', async () => {
      // 归档的意义就是从眼前挪走；「全部」照样列出来的话，归档等于没做。
      // **这条必须在接口层**：只在前端过滤的话，命令行调用方和执行器都绕过它，
      // 两处对同一个词各执一词。
      await 取(port, '/api/tickets', { method: 'POST', 体: { id: 'ARC-1', fm: { title: '要归档的' } } });
      await 取(port, '/api/tickets/ARC-1/move', { method: 'POST', 体: { 到: '已归档' } });

      const 默认 = await 取(port, '/api/tickets');
      assert.ok(!默认.体.工单.some((t) => t.id === 'ARC-1'), '默认列表里出现了已归档的单');

      const 显式 = await 取(port, '/api/tickets?state=' + encodeURIComponent('已归档'));
      assert.ok(显式.体.工单.some((t) => t.id === 'ARC-1'), '显式筛已归档反而看不到');

      // 参数名是中文，得自己编码——node 的 http.request 不接受未转义字符，
      // 直接写 `?含归档=1` 会抛 ERR_UNESCAPED_CHARACTERS（写这条时当场撞到）。
      const 全含 = await 取(port, '/api/tickets?' + encodeURIComponent('含归档') + '=1');
      assert.ok(全含.体.工单.some((t) => t.id === 'ARC-1'), '含归档=1 该给全表——查账时要用');

      // 归档可逆：取回之后又出现在默认列表里
      await 取(port, '/api/tickets/ARC-1/move', { method: 'POST', 体: { 到: '草稿' } });
      const 取回后 = await 取(port, '/api/tickets');
      assert.ok(取回后.体.工单.some((t) => t.id === 'ARC-1'), '取回之后该回到默认列表');
    });

    // ⚠ 这里**只测被拒的路径**，故意不测成功路径。
    // 成功一次就会把真的 config/工单库.local.json 改掉——测试进程用的是真仓根，
    // 不是沙盒。手工验的时候正是这样把用户配置覆盖了，11 张单当场从看板上消失。
    // 成功路径已在上面用假平台根做过单测；这里守的是门禁与入参校验。
    await ta('POST /api/setup/tickets 校验入参，且不因为是配置接口就松门禁', async () => {
      const 相对 = await 取(port, '/api/setup/tickets', { method: 'POST', 体: { root: './单' } });
      assert.equal(相对.码, 400);
      assert.ok(/绝对路径/.test(相对.体.error), 相对.体.error);
      const 空 = await 取(port, '/api/setup/tickets', { method: 'POST', 体: {} });
      assert.equal(空.码, 400);
      const 自身 = await 取(port, '/api/setup/tickets', { method: 'POST', 体: { root: path.join(平台根, '单') } });
      assert.equal(自身.码, 400);
      // 无令牌必须 401——这个口子能决定业务数据落在哪儿，比读接口更该守
      const 裸 = await new Promise((resolve, reject) => {
        const q = http.request({ host: '127.0.0.1', port, path: '/api/setup/tickets', method: 'POST',
          headers: { 'Content-Type': 'application/json' } }, (res) => {
          let s = ''; res.on('data', (d) => s += d); res.on('end', () => resolve({ 码: res.statusCode }));
        });
        q.on('error', reject); q.write(JSON.stringify({ root: 'D:/x' })); q.end();
      });
      assert.equal(裸.码, 401);
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
      // 父单**不带项目**：协-007 起，建单会校验项目必须在注册表里，
      // 而这个测试跑的是真配置（沙盒只隔离了工单库，不隔离 config）。
      // 写一个真实注册过的项目名会让测试跟着某台机器的本地配置走——那种耦合迟早红。
      // 项目校验本身在 test/项目契约.test.js 里用假配置单独验，不靠这条。
      await 取(port, '/api/tickets', { method: 'POST', 体: { id: 'P-1', fm: { id: 'P-1', title: '父单' } } });
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
