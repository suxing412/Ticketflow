// staff.test.js — 职能编制变更：扩编补人 / 缩编移空闲 / 忙者退役待归 / 上限推导
const assert = require('node:assert');
const staff = require('../lib/staff');
const { makeRoot, seed, CFG } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('staff 编制变更测试');
const clone = () => JSON.parse(JSON.stringify(CFG));

t('扩编：策划 1→3，按 -B/-C 补人，沿用职能默认执行池', () => {
  const root = makeRoot(); const cfg = clone();
  const r = staff.setStaff(root, cfg, '策划', 3);
  assert.equal(r.ok, true);
  assert.deepEqual(r.新增, ['策划-B', '策划-C']);
  const mine = cfg.agents.filter((a) => a.职能 === '策划');
  assert.equal(mine.length, 3);
  assert.ok(mine.every((a) => a.执行池 === 'claude' && a.上线 !== false));
});

t('缩编空闲者：策划 1→0，空闲直接移除', () => {
  const root = makeRoot(); const cfg = clone();
  const r = staff.setStaff(root, cfg, '策划', 0);
  assert.deepEqual(r.移除, ['策划-A']);
  assert.equal(cfg.agents.filter((a) => a.职能 === '策划').length, 0);
});

t('缩编忙者：正持单的标退役待归（不粗暴打断）', () => {
  const root = makeRoot(); const cfg = clone();
  seed(root, '在途', { id: 'X', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
  const r = staff.setStaff(root, cfg, '策划', 0);
  assert.deepEqual(r.退役, ['策划-A']);
  const a = cfg.agents.find((x) => x.id === '策划-A');
  assert.equal(a.上线, false); // 留在编制表里、退役待归，干完退场
});

t('onlineCount = 在岗人数（退役待归不计）', () => {
  const root = makeRoot(); const cfg = clone();
  assert.equal(staff.onlineCount(cfg), 3); // 策划-A 程序-A QA-A
  seed(root, '在途', { id: 'X', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
  staff.setStaff(root, cfg, '策划', 0);
  assert.equal(staff.onlineCount(cfg), 2);
});

t('非法输入：未知职能 / 越界人数被拒', () => {
  const root = makeRoot(); const cfg = clone();
  assert.equal(staff.setStaff(root, cfg, '音效', 1).ok, false);
  assert.equal(staff.setStaff(root, cfg, '策划', 99).ok, false);
});

console.log(`全部通过：${passed} 项`);
