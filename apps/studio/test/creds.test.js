// creds.test.js — 凭据托管（2026-08-08：路 B + codex + deepseek）
// 这套测试的红线：**任何路径下密钥都不许以明文落盘**，加密不可用时必须拒绝保存而不是降级。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const creds = require('../lib/creds');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('creds 凭据托管测试（2026-08-08 路 B）');

const 新根 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'creds-'));

// 假 DPAPI：base64 往返，形状与真 PowerShell 一致（明文走 env，不进 argv）
const 假 = {
  execFileSync: (cmd, args, o) => {
    const s = args[args.length - 1];
    if (s.includes('ConvertFrom-SecureString')) return 'ENC:' + Buffer.from(o.env.__STUDIO_P, 'utf8').toString('base64');
    return Buffer.from(String(o.env.__STUDIO_C).replace(/^ENC:/, ''), 'base64').toString('utf8');
  },
};
const 坏 = { execFileSync: () => { throw new Error('DPAPI unavailable'); } };
const 空返回 = { execFileSync: () => '' };

t('存取往返：落盘是密文，读回是明文', () => {
  const root = 新根();
  creds.清缓存();
  const r = creds.setKey(root, 'deepseek', { key: 'sk-abcdefgh1234', base: 'https://api.example.com', 模型: 'ds-v4' }, 假);
  assert.equal(r.ok, true);
  assert.equal(r.指纹, '●●●●1234');
  creds.清缓存();
  assert.equal(creds.getKey(root, 'deepseek', 假), 'sk-abcdefgh1234');
});

t('红线：磁盘上搜不到明文 key（只有密文）', () => {
  const root = 新根();
  creds.清缓存();
  creds.setKey(root, 'deepseek', { key: 'sk-SUPERSECRET99' }, 假);
  const raw = fs.readFileSync(creds.FILE(root), 'utf8');
  assert.ok(!raw.includes('sk-SUPERSECRET99'), '明文落盘 = 本模块存在的意义被否定');
  assert.ok(raw.includes('ENC:'), '应当是密文');
});

t('红线：DPAPI 挂了就拒绝保存，绝不静默降级成明文', () => {
  const root = 新根();
  creds.清缓存();
  const r = creds.setKey(root, 'deepseek', { key: 'sk-abcdefgh1234' }, 坏);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('拒绝以明文保存'));
  assert.ok(!fs.existsSync(creds.FILE(root)), '失败时连文件都不该建');
});

t('红线：DPAPI 返回空密文同样拒绝', () => {
  const root = 新根();
  creds.清缓存();
  const r = creds.setKey(root, 'deepseek', { key: 'sk-abcdefgh1234' }, 空返回);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('空密文'));
});

t('明文只走环境变量，绝不进 argv（进程列表可见）', () => {
  let 见到的args = null;
  const 窥 = { execFileSync: (cmd, args, o) => { 见到的args = args; return 'ENC:x'; } };
  creds.清缓存();
  creds.encrypt('sk-LEAKME12345', 窥);
  assert.ok(!JSON.stringify(见到的args).includes('sk-LEAKME12345'), 'key 出现在命令行参数里 = 泄漏');
});

t('脱敏清单：密文与明文都不出 list()', () => {
  const root = 新根();
  creds.清缓存();
  creds.setKey(root, 'deepseek', { key: 'sk-abcdefgh1234', base: 'https://api.example.com', 模型: 'ds-v4' }, 假);
  const l = creds.list(root);
  assert.equal(l.length, 1);
  const s = JSON.stringify(l);
  assert.ok(!s.includes('sk-abcdefgh1234'), '明文泄漏');
  assert.ok(!s.includes('ENC:'), '密文也不该出去——远程客户端拿到密文没意义只有风险');
  assert.equal(l[0].指纹, '●●●●1234');
  assert.equal(l[0].base, 'https://api.example.com');
});

t('校验：key 太短 / 池名空 / base 非法 一律拒', () => {
  const root = 新根();
  creds.清缓存();
  assert.equal(creds.setKey(root, 'x', { key: 'short' }, 假).ok, false);
  assert.equal(creds.setKey(root, '', { key: 'sk-abcdefgh1234' }, 假).ok, false);
  assert.equal(creds.setKey(root, 'x', { key: 'sk-abcdefgh1234', base: '不是URL' }, 假).ok, false);
});

t('删除：清记录 + 清明文缓存，getKey 立刻失效', () => {
  const root = 新根();
  creds.清缓存();
  creds.setKey(root, 'deepseek', { key: 'sk-abcdefgh1234' }, 假);
  assert.equal(creds.has(root, 'deepseek'), true);
  assert.equal(creds.remove(root, 'deepseek').ok, true);
  assert.equal(creds.has(root, 'deepseek'), false);
  assert.equal(creds.getKey(root, 'deepseek', 假), null);
  assert.equal(creds.remove(root, 'deepseek').ok, false, '重复删要报错不能装作成功');
});

t('缓存：解密只跑一次，第二次读走内存', () => {
  const root = 新根();
  creds.清缓存();
  creds.setKey(root, 'deepseek', { key: 'sk-abcdefgh1234' }, 假);
  creds.清缓存();
  let 次数 = 0;
  const 计 = { execFileSync: (c, a, o) => { 次数++; return 假.execFileSync(c, a, o); } };
  creds.getKey(root, 'deepseek', 计);
  creds.getKey(root, 'deepseek', 计);
  assert.equal(次数, 1, '每拉一次会话就 spawn 一次 PowerShell 太贵');
});

t('缓存键带 root：两个工作区互不串（自测抓到的真 bug，改前会串）', () => {
  const a = 新根(); const b = 新根();
  creds.清缓存();
  creds.setKey(a, 'deepseek', { key: 'sk-AAAAAAAA1111' }, 假);
  creds.setKey(b, 'deepseek', { key: 'sk-BBBBBBBB2222' }, 假);
  assert.equal(creds.getKey(a, 'deepseek', 假), 'sk-AAAAAAAA1111');
  assert.equal(creds.getKey(b, 'deepseek', 假), 'sk-BBBBBBBB2222');
  const 空根 = 新根();
  assert.equal(creds.getKey(空根, 'deepseek', 假), null, '没配过凭据的工作区不许借到别人的 key');
});

t('缺文件/坏文件容错：返回空库，不抛', () => {
  const root = 新根();
  assert.deepEqual(creds.read(root).池, {});
  fs.writeFileSync(creds.FILE(root), '{ 这不是 json', 'utf8');
  assert.deepEqual(creds.read(root).池, {});
  assert.equal(creds.getKey(root, 'deepseek', 假), null);
  assert.deepEqual(creds.list(root), []);
});

t('meta：给 UI 与 runner 看端点配置，不含 key', () => {
  const root = 新根();
  creds.清缓存();
  creds.setKey(root, 'deepseek', { key: 'sk-abcdefgh1234', base: 'https://api.example.com', 模型: 'ds-v4' }, 假);
  const m = creds.meta(root, 'deepseek');
  assert.equal(m.base, 'https://api.example.com');
  assert.equal(m.模型, 'ds-v4');
  assert.ok(!JSON.stringify(m).includes('sk-'), 'meta 不许带 key');
  assert.equal(creds.meta(root, '不存在'), null);
});

t('可加密()：链路自检，坏了如实报 false 不抛', () => {
  assert.equal(creds.可加密(假), true);
  assert.equal(creds.可加密(坏), false);
});

console.log(`全部通过：${passed} 项`);
