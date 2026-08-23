// oauth-reset.test.js — 重置(root) 按仓清拒派记忆（2026-08-22 体检 · 顺手 bug）
//
// 病灶：拒键() 拼的分隔符是 NUL（`${root}\u0000${单}`，见 lib/oauth.js:301 那段头注），
// 而 重置(root) 的按仓清理写的是 `k.startsWith(root + ' ')`（一个空格）。两边对不上 ⇒
// **重置(root) 这条路从来没清掉过一条拒派记忆**，只有无参的全清路径有效。
// 症状是静默的：重登/换仓后「首拒」不会再响一次，因为账上还记着上一轮的因键。
//
// 判据真跑函数、看真状态机的输出（记/首/次数），不看源码文本。
const assert = require('node:assert');
const oauth = require('../lib/oauth');
const { 收尾 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('OAuth 拒派记忆按仓复位测试');

const A = 'D:/仓A';
const B = 'D:/仓A2'; // 故意取 A 的前缀延伸，钉住「别拿裸 root 当前缀」

t('重置(root) 真把该仓的拒派记忆清了（首拒能再响一次）', () => {
  oauth.重置(); // 从干净局面起
  const 一 = oauth.拒派留痕(A, 'P-1', '额度不足');
  assert.deepEqual([一.记, 一.首, 一.次数], [true, true, 1], '首拒该记一条：' + JSON.stringify(一));
  const 二 = oauth.拒派留痕(A, 'P-1', '额度不足');
  assert.deepEqual([二.记, 二.次数], [false, 2], '同因复拒只累计不再记：' + JSON.stringify(二));

  oauth.重置(A);

  const 三 = oauth.拒派留痕(A, 'P-1', '额度不足');
  assert.deepEqual([三.记, 三.首, 三.次数], [true, true, 1],
    '重置(root) 之后该像刚开机一样——实测 ' + JSON.stringify(三) + '，说明这条记忆根本没被清掉（分隔符对不上）');
  oauth.重置();
});

t('重置(root) 只清自己那仓，不误伤别的仓（含前缀延伸的仓名）', () => {
  oauth.重置();
  oauth.拒派留痕(A, 'P-1', '额度不足');
  oauth.拒派留痕(B, 'P-1', '额度不足');

  oauth.重置(A);

  const a = oauth.拒派留痕(A, 'P-1', '额度不足');
  assert.equal(a.首, true, 'A 仓该被清干净');
  const b = oauth.拒派留痕(B, 'P-1', '额度不足');
  assert.deepEqual([b.记, b.次数], [false, 2], 'B 仓不该被 A 的重置误伤（裸 root 当前缀就会踩这一格）：' + JSON.stringify(b));
  oauth.重置();
});

t('拒派恢复 与 重置 同源：清过之后「之前拦过吗」也要答没有', () => {
  oauth.重置();
  oauth.拒派留痕(A, 'P-9', '凭据过期');
  const 有 = oauth.拒派恢复(A, 'P-9');
  assert.deepEqual([有.记, 有.次数], [true, 1], '拦过就该交出账：' + JSON.stringify(有));

  oauth.拒派留痕(A, 'P-9', '凭据过期');
  oauth.重置(A);
  const 无 = oauth.拒派恢复(A, 'P-9');
  assert.deepEqual([无.记, 无.次数], [false, 0], '重置后不该还认得这笔账：' + JSON.stringify(无));
  oauth.重置();
});

收尾('', passed);
