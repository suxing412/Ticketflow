// 呼叫信箱（0.21，用户拍板「所有监视器统一为一个嵌入监制台」）：
// 需要制作人层（Claude/用户）介入或知晓的事件，全部结构化落此信箱——
// 会话侧只需一条监视器 tail 本文件，每行都是呼叫（不再用正则猜日志措辞，漏报机制性绝根）。
// journal 仍是人读流水；信箱是机器信道。级别：急=需要行动，常=知会即可。
const fs = require('fs');
const path = require('path');

const FILE = (root) => path.join(root, '呼叫', 'inbox.jsonl');

// 噪声类型不进收件箱（制作人 2026-08-21 00:02 批准）。
// 案源：08-20 盘账实测 377 条未读里，巡检异常 66 + 编辑器占用 56 = 122 条机器心跳，
// 把真正的人闸通知（专项待签 6、收口报告 6、裁决上呈 5、代核不过 5、上呈 3）全埋了。
// 收件箱是「要人动手的事」的册子，不是事件总线——机器心跳该去 journal。
// 闸立在 post() 而不是逐个改调用点：将来新增的心跳类型不会漏网，且只此一处可查。
// 注意它只拦**收件箱**，journal 照记——不是丢弃信息，是换个地方放。
// 划线判据：**这条通知要不要人动手**。
//   要人动手 → 进收件箱（零派发＝链条停摆、零输出＝会话跑死，都得人去捞）
//   只是「系统在呼吸」→ 降级进 journal（巡检异常、编辑器占用、打点停滞）
// 收窄过两轮，两轮都是被既有测试打红纠正的，记在这儿当判例：
//   首版划进 零派发/零输出 —— 错。链条停摆、会话跑死都要人去捞，是急件不是呼吸。
//   二版划进 打点停滞     —— 也错。它带具体单号，说的是「这一单卡住了」，要人去看。
// 剩下的两条才是真心跳：巡检异常（每 15 分钟一拍的巡检结论）、编辑器占用（工程被开着这个事实）。
// **噪声表宁可窄**：漏拦一条只是多一行噪声，错拦一条是把要人动手的事静音了。
// 扩它之前先问一句：这条通知要不要人动手？要 → 不许进这个表。
const 噪声类型 = new Set(['巡检异常', '编辑器占用']);

function post(root, 级别, 类型, 摘要, extra) {
  if (噪声类型.has(String(类型))) {
    try { require('./journal').append(root, `[降级不入收件箱] ${类型}：${String(摘要).slice(0, 160)}`); } catch { /* 尽力 */ }
    return { ok: true, 降级: true };
  }
  try {
    fs.mkdirSync(path.dirname(FILE(root)), { recursive: true });
    const entry = { t: new Date().toISOString(), 级别, 类型, 摘要: String(摘要).slice(0, 300), ...(extra || {}) };
    fs.appendFileSync(FILE(root), JSON.stringify(entry) + '\n', 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function list(root, limit) {
  try {
    const lines = fs.readFileSync(FILE(root), 'utf8').trim().split('\n').filter(Boolean);
    // limit === Infinity ＝ 要全量（未读走这条）。显式判出来，别依赖 slice(-Infinity) 返回全量这个冷知识。
    const 取 = (limit === Infinity) ? lines : lines.slice(-(limit || 100));
    return 取.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// 已读水位（游标制，不改写历史行——append-only 纪律）
const CURSOR = (root) => path.join(root, '呼叫', 'cursor.json');
// 未读**不走尾截**（2026-08-22 体检 #69）：原写 list(root, 500) 先切到末 500 行再按游标过滤——
// 早于游标线但落在 500 行之外的未读会被静默丢掉，不报错、不计数，把「读不完」伪装成「没有更多」。
// 也不改成「从尾向前扫到首个 t <= at 即停」：post() 由 server/agent/瞭望塔多进程各自 append 且各取
// new Date()，一次乱序就会让早停提前终止，丢得比现在更多。直接全量读——list() 本来就 readFileSync
// 全文再 slice，尾截一分钱 I/O 都没省（现网 61KB）。
// 缺 t 的行不许静默消失：undefined > string 恒 false，故显式当未读处理，由消费端看见它。
function unread(root) {
  let at = '';
  try { at = JSON.parse(fs.readFileSync(CURSOR(root), 'utf8')).at || ''; } catch { /* 从头 */ }
  return list(root, Infinity).filter((e) => !e.t || e.t > at);
}
function markRead(root) {
  fs.mkdirSync(path.dirname(CURSOR(root)), { recursive: true });
  fs.writeFileSync(CURSOR(root), JSON.stringify({ at: new Date().toISOString() }), 'utf8');
  return { ok: true };
}

module.exports = { FILE, post, list, unread, markRead, 噪声类型 };
