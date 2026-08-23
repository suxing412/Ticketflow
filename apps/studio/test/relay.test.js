// relay.test.js — 遥控传令板：追加/读取/校验
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relay = require('../lib/relay');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('relay 遥控传令测试');

t('追加与读取回环，按序返回', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.ok(relay.append(root, '制作人', '把地形晕染开个单').ok);
  assert.ok(relay.append(root, 'Claude', '收到，已开 TK-41').ok);
  const l = relay.list(root);
  assert.equal(l.length, 2);
  assert.equal(l[0].from, '制作人');
  assert.equal(l[1].from, 'Claude');
  assert.ok(l[0].t && l[0].text);
});

t('空指令/超长/非法署名拒收', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.ok(!relay.append(root, '制作人', '  ').ok);
  assert.ok(!relay.append(root, '制作人', 'x'.repeat(4001)).ok);
  assert.ok(!relay.append(root, '路人', '冒名').ok);
});

t('limit 截尾取最新', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  for (let i = 0; i < 5; i++) relay.append(root, '制作人', '第' + i + '条');
  const l = relay.list(root, 2);
  assert.equal(l.length, 2);
  assert.equal(l[1].text, '第4条');
});

t('无文件不炸', () => {
  assert.deepEqual(relay.list(fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'))), []);
});

// ---- 拒收留痕（坑档案-017 治本条）----
// 案源：五处生产调用（brain×4 / wake）全部裸吞 append 的返回值，server 那处也只回 400 不落账。
// 于是白名单漏一个署名 = 发言凭空消失、零痕迹可查。三条拒收路径都必须在 journal 留下线索。
const 月志 = (root) => {
  const d = new Date();
  const f = path.join(root, 'journal', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.log`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

t('非法署名被拒 → journal 留痕（静默丢弃绝根：坑档案-017）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.ok(!relay.append(root, '路人', '这条会被白名单挡掉').ok);
  const log = 月志(root);
  assert.ok(log.includes('信道拒收（非法署名）'), '拒收必须留痕');
  assert.ok(log.includes('路人'), '留痕要写清是谁的发言被挡了');
  assert.ok(log.includes('这条会被白名单挡掉'), '留痕要带正文片段，否则事后查不出丢了什么');
});

t('空指令与超限拒收同样留痕（三条拒收路径一条都不许静默）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.ok(!relay.append(root, '项管', '   ').ok);
  assert.ok(!relay.append(root, '项管', 'x'.repeat(4001)).ok);
  const log = 月志(root);
  assert.ok(log.includes('信道拒收（空指令不收）'));
  assert.ok(log.includes('信道拒收（单条 ≤4000 字）'));
});

t('拒收留痕不改变返回契约（调用方看到的仍是 ok:false + 原文案）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.deepEqual(relay.append(root, '路人', '冒名'), { ok: false, error: '非法署名' });
  assert.equal(relay.list(root).length, 0, '拒收就是拒收，不许被留痕改判成收下');
});

t('发()：超限自剪投递而不是整条消失（TK-146 下半截病）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  const r = relay.发(root, '项管', '简' + 'x'.repeat(6000));
  assert.ok(r.ok, '长简报不许被静默吞掉');
  const l = relay.list(root);
  assert.equal(l.length, 1);
  assert.ok(l[0].text.length <= 4000);
  assert.ok(l[0].text.startsWith('简'), '保留开头（最要紧的话在前面）');
  assert.ok(l[0].text.endsWith('…（全文见台账/回执）'), '节选要自报家门');
  assert.ok(月志(root).includes('信道自剪投递'), '自剪也要留痕：制作人读到的是节选');
});

t('发()：正常长度原样投递，不加尾巴不留自剪痕', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.ok(relay.发(root, '项管', '短消息').ok);
  assert.equal(relay.list(root)[0].text, '短消息');
  assert.ok(!月志(root).includes('信道自剪投递'));
});

console.log(`全部通过：${passed} 项`);
