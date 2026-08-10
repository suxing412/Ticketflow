// 接线契约测试 — 钉住「lib/ 里的模块有没有真的接到接口上」。
//
// 为什么单开一份：公用件契约测试管的是「我们消费 packages/ 的那一面」，
// 这份管的是「本仓自己的模块有没有被用起来」。2026-08-10 清点发现 lib/ 下六个模块
// 全是孤儿——写好了、测过了、一个都没接线，server.js 从头到尾只 require 了 4 个东西。
// 孤儿模块不会报错，只会安静地不存在，所以必须有断言盯着。
'use strict';
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const ta = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('接线契约测试');

const 平台根 = path.resolve(__dirname, '..');
const 源 = fs.readFileSync(path.join(平台根, 'server.js'), 'utf8');

// ---- 这条是本文件的核心：桩模式的物理保证 ----
// server.js 声称「本文件不引入 child_process，任何路径都发不起真实 CLI 进程，零计费」。
// 这个承诺不能只靠自觉——接线时随手 require 一个带 child_process 的模块就破了，
// 而且破了不会有任何报错，只会在某天真的把钱花出去。故做**传递闭包**检查。
t('桩模式物理保证：server.js 的依赖闭包里没有 child_process', () => {
  const 已看 = new Set();
  const 违规 = [];
  const 走 = (文件) => {
    if (已看.has(文件)) return;
    已看.add(文件);
    let src;
    try { src = fs.readFileSync(文件, 'utf8'); } catch { return; }
    // 只认真正的 require，注释里提到这个词不算
    for (const m of src.matchAll(/require\(\s*'([^']+)'\s*\)/g)) {
      const 目标 = m[1];
      if (目标 === 'child_process' || 目标 === 'node:child_process') {
        违规.push(`  ${path.relative(平台根, 文件)} 引入了 ${目标}`);
        continue;
      }
      if (!目标.startsWith('.')) continue;                 // 其余内置/三方模块不追
      const 解析 = path.resolve(path.dirname(文件), 目标);
      走(fs.existsSync(解析 + '.js') ? 解析 + '.js' : 解析);
    }
  };
  走(path.join(平台根, 'server.js'));
  assert.deepEqual(违规, [], '桩模式已被破坏——server.js 现在能起真实进程了：\n' + 违规.join('\n'));
});

t('lib/ 下的模块要么被接线，要么在 server.js 里写明为何不接', () => {
  const 模块 = [];
  const 扫 = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p); continue; }
      if (d.name.endsWith('.js')) 模块.push(path.relative(path.join(平台根, 'lib'), p).replace(/\\/g, '/'));
    }
  };
  扫(path.join(平台根, 'lib'));

  const 漏网 = [];
  for (const m of 模块) {
    const 无后缀 = m.replace(/\.js$/, '');
    const 接线了 = 源.includes(`./lib/${无后缀}`);
    // 未接线的必须在 server.js 头部被点名交代原因，否则就是"忘了"而不是"决定不接"
    const 交代了 = new RegExp(`${无后缀.split('/').pop()}[^\\n]*不接`).test(源)
      || new RegExp(`${无后缀}[^\\n]*不接`).test(源);
    if (!接线了 && !交代了) 漏网.push(`  lib/${m}`);
  }
  assert.deepEqual(漏网, [], '这些模块既没接线，也没写明为何不接（孤儿模块不会报错，只会安静地不存在）：\n' + 漏网.join('\n'));
});

// ---- 接口实跑 ----
// 只断言字段契约，不断言具体数值——分数会随配置和历史变，钉死数值等于给自己挖回归坑。
// server.js 打印的是**配置里的**端口，不是实际监听到的端口——所以 PORT=0 那招行不通
// （它会老实打印 127.0.0.1:0）。先自己探一个空闲端口，再显式传给它。
const 探空闲端口 = () => new Promise((resolve, reject) => {
  const probe = require('net').createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});

const 起服务 = async () => {
  const port = await 探空闲端口();
  const env = { ...process.env, PORT: String(port) };
  delete env.TICKETFLOW_PACKAGES;
  const srv = require('child_process').spawn(process.execPath, [path.join(平台根, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const 超时 = setTimeout(() => reject(new Error('server 起不来（10s 无开机日志）')), 10000);
    srv.stdout.on('data', (d) => {
      if (String(d).includes('开机')) { clearTimeout(超时); resolve(); }
    });
    srv.on('error', reject);
  });
  return { srv, port };
};

const 取 = (port, 路径, 选项 = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: 路径, method: 选项.method || 'GET', headers: 选项.体 ? { 'Content-Type': 'application/json' } : {} }, (res) => {
    let s = ''; res.on('data', (d) => s += d);
    res.on('end', () => { try { resolve({ 码: res.statusCode, 体: JSON.parse(s) }); } catch (e) { reject(new Error('非 JSON 响应：' + s.slice(0, 200))); } });
  });
  req.on('error', reject);
  if (选项.体) req.write(JSON.stringify(选项.体));
  req.end();
});

(async () => {
  const { srv, port } = await 起服务();
  try {
    await ta('GET /api/routing/rank 返回排名与理由', async () => {
      const r = await 取(port, '/api/routing/rank?role=generalist');
      assert.equal(r.码, 200);
      assert.equal(r.体.ok, true);
      assert.ok(Array.isArray(r.体.排名), '排名必须是数组');
      assert.ok(r.体.排名.length >= 1, `应至少排出一个候选（实得 ${r.体.排名.length}）`);
      for (const 项 of r.体.排名) {
        assert.equal(typeof 项.名称, 'string');
        assert.equal(typeof 项.分数, 'number');
        assert.ok(Array.isArray(项.理由) && 项.理由.length, '每个候选都要给出理由——不透明的排名没人敢信');
      }
      assert.equal(r.体.选中, r.体.排名[0].名称, '选中的必须是排第一的');
      assert.equal(typeof r.体.有区分度, 'boolean');
      // 全平局必须自曝：把「字母序第一」当成「评估最优」比没有排名更危险
      if (!r.体.有区分度) {
        assert.ok(/无区分度/.test(r.体.说明), '平局时说明里要写明无区分度：' + r.体.说明);
        assert.ok(/scores|prefer|战绩/.test(r.体.说明), '要告诉人怎么让排名变得有信号：' + r.体.说明);
      }
    });

    await ta('GET /api/routing/history 无记录时也给出账本路径与说明', async () => {
      const r = await 取(port, '/api/routing/history');
      assert.equal(r.码, 200);
      assert.equal(r.体.ok, true);
      assert.ok(r.体.账本.endsWith(path.join('journal', 'provider-runs.jsonl')));
      assert.ok(Array.isArray(r.体.记录));
      if (!r.体.记录.length) assert.ok(r.体.说明, '空账本要说明为什么空，否则看起来像坏了');
    });

    await ta('GET /api/toolchain 报告就位与否，并给出注入指引', async () => {
      const r = await 取(port, '/api/toolchain');
      assert.equal(r.码, 200);
      assert.equal(typeof r.体.就位, 'boolean');
      assert.ok(Array.isArray(r.体.候选路径));
      assert.ok(r.体.注入指引.length > 0, '不论就位与否都要给 Agent 一段人话指引');
    });

    await ta('POST /api/review/parse 把 Markdown 评审归一成字段', async () => {
      const 报告 = ['结论：不过', '', '## 阻断问题', '- 空指针未处理', '- 缺回滚路径', '', '## 验收证据', '- 复现步骤见附件'].join('\n');
      const r = await 取(port, '/api/review/parse', { method: 'POST', 体: { 文本: 报告 } });
      assert.equal(r.码, 200);
      assert.equal(r.体.ok, true);
      // 字段是中文键（结论/问题/风险/证据），这是 review-opinion.js 的既有契约，勿按英文猜
      assert.equal(r.体.结论, '不过', '「结论：不过」必须解析成不过');
      assert.ok(r.体.问题.length >= 2, `阻断问题应解析出 2 条（实得 ${r.体.问题.length}）`);
      assert.ok(r.体.证据.length >= 1, '验收证据节应被解析出来');
      assert.equal(typeof r.体.原文, 'string', '要保留原文供人工复核');
    });

    await ta('POST /api/review/parse 缺字段时报人话错误', async () => {
      const r = await 取(port, '/api/review/parse', { method: 'POST', 体: { 没有文本: 1 } });
      assert.equal(r.码, 400);
      assert.ok(r.体.error.includes('文本'), '错误里要写清缺什么：' + r.体.error);
    });

    await ta('POST /api/plan/validate 把 Orchestrator 输出解析成 DAG', async () => {
      const 输出 = ['我建议这样拆：', '```json', JSON.stringify({
        summary: '两步走',
        tasks: [
          { key: 'a', title: '写接口', role: 'backend', acceptance: ['接口返回 200'] },
          { key: 'b', title: '评审', role: 'reviewer', dependsOn: ['a'], acceptance: ['无阻断问题'] },
        ],
      }), '```'].join('\n');
      const r = await 取(port, '/api/plan/validate', { method: 'POST', 体: { 输出 } });
      assert.equal(r.码, 200);
      assert.equal(r.体.合规, true, '合法计划应通过校验：' + (r.体.原因 || ''));
      assert.equal(r.体.任务数, 2);
      assert.equal(r.体.任务[1].依赖[0], 'a', '依赖关系要保留');
    });

    await ta('POST /api/plan/validate 对不合规计划给 200 + 合规:false（不是 5xx）', async () => {
      const r = await 取(port, '/api/plan/validate', { method: 'POST', 体: { 输出: '我觉得先干这个再干那个' } });
      assert.equal(r.码, 200, '校验不通过是业务结果，不是服务故障');
      assert.equal(r.体.合规, false);
      assert.ok(r.体.原因 && r.体.原因.length, '要说明哪里不合规');
    });

    t('materialize 缺注入 store 时明确报错，不静默降级', () => {
      const 计划 = require(path.join(平台根, 'lib', 'orchestration', 'plan.js'));
      assert.throws(
        () => 计划.materialize('/tmp', {}, { id: 'T-1', fm: {} }, { tasks: [] }),
        (e) => {
          assert.ok(e.message.includes('store'), '错误里要点名缺的是 store：' + e.message);
          return true;
        },
        '缺 store 必须抛错——悄悄什么都不写比直接失败难查得多',
      );
    });

    await ta('原有四条接口未被新接线打断', async () => {
      for (const p of ['/api/health', '/api/watchtower', '/api/providers']) {
        const r = await 取(port, p);
        assert.equal(r.码, 200, p + ' 应仍为 200');
        assert.equal(r.体.ok, true, p + ' 应仍 ok');
      }
      const h = await 取(port, '/api/health');
      assert.equal(h.体.桩模式, true, '桩模式标记不能因接线而改变');
    });

    await ta('查询串解析不影响未知 API 的 404', async () => {
      // http.request 不接受未编码的非 ASCII 路径，这是客户端的规矩，得自己编
      const r = await 取(port, encodeURI('/api/不存在') + '?role=x');
      assert.equal(r.码, 404);
      assert.ok(!r.体.error.includes('?'), '404 回显的路径不应带查询串：' + r.体.error);
      assert.ok(r.体.error.startsWith('未知 API：/api/'), '404 要回显路径：' + r.体.error);
    });

    console.log(`全部通过：${passed} 项`);
  } finally {
    srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
