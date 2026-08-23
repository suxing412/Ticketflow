// relay.js — 遥控传令板：制作人（手机端）↔ Claude 制作人层 的双向留言通道
// 明文 jsonl 落盘（透明化）；Claude 侧由会话监视器 tail 该文件唤醒，回帖走同一文件。
// 定位：监制台内的保底指挥通道（官方 Remote Control 之外的第二路）。
const fs = require('fs');
const path = require('path');

const FILE = (root) => path.join(root, '遥控', 'thread.jsonl');

// 拒收留痕（坑档案-017 治本条）：校验不过就 return {ok:false} 是**静默丢弃**——
// 五处生产调用里 brain.js×4 与 wake.js 全部裸吞返回值（catch 注释「信道失败不阻塞」），
// server.js 那处也只回 400 不落账。于是白名单再漏一个署名、或哪条发言超了 4000 字，
// 制作人那边就只是「项管没说话」，全链零痕迹可查（2026-08-05 白名单案的下半截病）。
// 留痕点收在这里而不是逐个改调用点：新调用方天生带痕，且只此一处可查。
// journal 而不是信箱：这是「信道自己出事了」的取证线索，不是要人立刻动手的活。
function 拒收(root, from, t, error) {
  try {
    require('./journal').append(root, `信道拒收（${error}）· 署名 ${from || '（空）'} · ${String(t).slice(0, 80)}`);
  } catch { /* 留痕失败不改变拒收结论 */ }
  return { ok: false, error };
}

function append(root, from, text) {
  const t = String(text || '').trim();
  if (!t) return 拒收(root, from, t, '空指令不收');
  if (t.length > 4000) return 拒收(root, from, t, '单条 ≤4000 字');
  // 项管入列（2026-08-05 夜班推演案：答话/简报/收口/起草的信道发言全被旧白名单静默丢弃）
  if (!['制作人', 'Claude', '项管'].includes(from)) return 拒收(root, from, t, '非法署名');
  fs.mkdirSync(path.dirname(FILE(root)), { recursive: true });
  const entry = { t: new Date().toISOString(), from, text: t };
  fs.appendFileSync(FILE(root), JSON.stringify(entry) + '\n', 'utf8');
  return { ok: true, entry };
}

// 自剪投递：超限**不是拒收就完事**——正文宁可节选也不能整条消失（TK-146 下半截病；
// wake.js 已在调用点手写过一遍同样的自剪，这里收成公用件给 brain.js 那几处长文用）。
// 与 append 的分工：append 是硬校验口（守 4000 字硬顶），发 是给「本来就可能长」的正文用的投递口。
function 发(root, from, text, 尾 = '…（全文见台账/回执）') {
  const t = String(text || '');
  if (t.length <= 4000) return append(root, from, t);
  try { require('./journal').append(root, `信道自剪投递（原文 ${t.length} 字 > 4000）· 署名 ${from}`); } catch { /* 留痕失败不阻塞投递 */ }
  return append(root, from, t.slice(0, 4000 - 尾.length) + 尾);
}

function list(root, limit = 100) {
  try {
    const lines = fs.readFileSync(FILE(root), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = { append, 发, list, FILE, 拒收 };
