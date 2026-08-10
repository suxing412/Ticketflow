// crew.test.js — 工程队卡（施工令-002 立卡 → 施工令-041 §五 改直读）
// 041 起卡上四字段全部从 工程队/ 目录实况现算：最新 施工令-NNN、同号回执在不在、文件 mtime。
// 状态.json 作废（巡礼 F8：卡上还挂着 002，工程队实际已经干到 040——一份要人记得更新的镜子，
// 迟早照的是昨天）。本文件测的是**读逻辑的骨架**；五态×三消费那一层在 schedule-view.test.js。
// 铁律不变：生产部署下这个目录根本不存在，读不到不能抛错——整卡不渲染（read 返回 null）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crew = require('../lib/crew');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('crew 工程队卡直读测试（施工令-041 §五）');

const 造队 = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-'));
  for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(d, n), s || '# ' + n, 'utf8');
  return d;
};

t('四字段来自目录实况：最新施工令号 + 标题 + 状态 + mtime', () => {
  const d = 造队({ '施工令-002-短题制与工程队状态卡.md': '', '施工令-041-排程台账B.md': '' });
  const c = crew.read(d);
  assert.deepEqual(Object.keys(c).sort(), ['名称', '状态', '更新时间', '施工令'].sort());
  assert.equal(c.施工令, '041');
  assert.equal(c.名称, '排程台账B');
  assert.equal(c.更新时间, fs.statSync(path.join(d, '施工令-041-排程台账B.md')).mtime.toISOString());
});

t('状态两态：同号回执在 → 完工；不在 → 在做', () => {
  const 在做 = 造队({ '施工令-041-排程台账B.md': '' });
  assert.equal(crew.read(在做).状态, '在做');
  fs.writeFileSync(path.join(在做, '回执-041.md'), '# 回执', 'utf8');
  assert.equal(crew.read(在做).状态, '完工');
});

t('完工态的更新时间取回执 mtime（卡上的时间要指向最后发生的那件事）', () => {
  const d = 造队({ '施工令-040-排程台账A.md': '', '回执-040.md': '' });
  assert.equal(crew.read(d).更新时间, fs.statSync(path.join(d, '回执-040.md')).mtime.toISOString());
});

t('取序号最大者，不取 mtime 最新者（补写旧令注释不许把老卡顶到最前）', () => {
  const d = 造队({ '施工令-041-排程台账B.md': '' });
  const 旧 = path.join(d, '施工令-009-enginectl-attach子集与基线.md');
  fs.writeFileSync(旧, '补一句注释', 'utf8'); // 后写 = mtime 更新
  assert.equal(crew.read(d).施工令, '041');
});

t('无标题的施工令：名称为空串但卡照出（有令号就有卡）', () => {
  // 一个目录读两遍，不是造两个目录各读一遍（原写法 042 实测抓到）：
  // 两次 造队 是两次写盘，mtime 差 1ms 就整条挂——这测的是「无标题也出卡」，不是文件系统的时钟精度。
  const d = 造队({ '施工令-007.md': '' });
  assert.deepEqual(crew.read(d), {
    施工令: '007', 名称: '', 状态: '在做',
    更新时间: fs.statSync(path.join(d, '施工令-007.md')).mtime.toISOString(),
  });
});

t('目录空 / 只有杂文件 / 目录不存在 → null 且不抛错（生产部署的常态）', () => {
  assert.equal(crew.read(造队({})), null);
  assert.equal(crew.read(造队({ '调研-引擎通道路径选型.md': '', '设计稿-004-在途卡.html': '' })), null);
  assert.equal(crew.read(path.join(os.tmpdir(), '压根不存在-' + Date.now())), null);
});

t('状态.json 已作废：只有它 → null（它不再是任何东西的事实源）', () => {
  assert.equal(crew.read(造队({ '状态.json': JSON.stringify({ 施工令: '002', 状态: '施工中' }) })), null);
});

t('传文件路径退化成读所在目录（老调用方传 状态.json 不炸）', () => {
  const d = 造队({ '施工令-041-排程台账B.md': '', '状态.json': '{}' });
  assert.equal(crew.read(path.join(d, '状态.json')).施工令, '041');
});

t('默认目录是施工令约定的工程队目录，且读它永不抛错', () => {
  assert.ok(/工程队\/?\\?$/.test(crew.默认目录) || crew.默认目录.endsWith('工程队'), crew.默认目录);
  assert.doesNotThrow(() => crew.read(), '读默认目录永不抛错（在不在都一样）');
});

console.log('全部通过：' + passed + ' 项');
