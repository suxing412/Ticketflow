// 输出提取 —— 把各家 CLI 的流式输出还原成「agent 最后说的那段话」。
//
// 为什么必须有这一层（2026-08-10 首次跨厂真判踩到）：
//   适配器声明了 outputFormat，但此前没人用它。质检直接拿**整条 JSONL 流**去解析，
//   于是 review-opinion 把流事件当成了评审正文——「阻断问题」里塞满了
//   {"type":"thread.started"} 这种行，而判官真正的结论埋在最后一条 item 里。
//
//   判官明明工作正常、结论也格式良好，回执却是一堆垃圾。这类错**不会报错**，
//   只会让质检意见变得不可读——而人看到一堆 JSON 只会以为「判官抽风了」。
//
// 纯计算，零 IO。
'use strict';

function 逐行JSON(文本) {
  const 出 = [];
  for (const 行 of String(文本 || '').split(/\r?\n/)) {
    const s = 行.trim();
    if (!s || s[0] !== '{') continue;
    try { 出.push(JSON.parse(s)); } catch { /* 非 JSON 行（日志/告警）跳过 */ }
  }
  return 出;
}

// claude --output-format stream-json：assistant 事件里累积 text 块。
// 取**最后一条** assistant 消息——中间的是思考过程与工具调用，结论在最后。
function 抽claude(文本) {
  const 事件 = 逐行JSON(文本);
  let 末 = '';
  for (const e of 事件) {
    if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      const 文 = e.message.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('');
      if (文.trim()) 末 = 文;
    }
    // 有些版本把最终结果放在 result 事件里
    if (e.type === 'result' && typeof e.result === 'string' && e.result.trim()) 末 = e.result;
  }
  return 末;
}

// codex --json：item.completed 里 type=agent_message 的 text。同样取最后一条。
function 抽codex(文本) {
  const 事件 = 逐行JSON(文本);
  let 末 = '';
  for (const e of 事件) {
    const it = e && e.item;
    if (e.type === 'item.completed' && it && it.type === 'agent_message' && typeof it.text === 'string' && it.text.trim()) {
      末 = it.text;
    }
  }
  return 末;
}

// 按适配器声明的格式抽正文。**抽不出来时回退原文**——
// 宁可让人看到原始输出，也不要返回空字符串：空会让上游误判成「零输出」，
// 进而把一次成功的运行记成失败，污染路由战绩。
function 抽正文(输出, 格式) {
  const 原 = String(输出 || '');
  let 抽 = '';
  if (格式 === 'claude-stream-json') 抽 = 抽claude(原);
  else if (格式 === 'codex-jsonl') 抽 = 抽codex(原);
  else return { 正文: 原, 来源: '原文（未知格式，未做提取）' };

  if (抽.trim()) return { 正文: 抽, 来源: 格式 };
  return {
    正文: 原,
    来源: `原文（${格式} 提取不到 agent 正文，可能是格式变了或进程没跑到出话就退了）`,
    提取失败: true,
  };
}

// 收尾事件 —— CLI 自己对这一趟的总结（协-024）。
//
// 案源：HW-4 连挂两次，回执里只有一句「退出码 1」。而 claude 的 stream-json
// **最后一行就写着为什么**：
//   {"type":"result","is_error":true,"stop_reason":"stop_sequence","num_turns":20,
//    "duration_api_ms":360633,"total_cost_usd":0.718,...}
// `num_turns: 20` + 停在半路（最后一条事件是 agent 正在读文件）= **回合数用光被截断**，
// 不是崩溃、不是限流、也不是活干砸了。
//
// 「退出码 1」把这三件完全不同的事说成同一件，而处置方式南辕北辙：
// 截断该调大回合上限或拆单，崩溃该看栈，限流该等窗口。
// 判据就摆在输出的最后一行，只是从来没人读它。
//
// 补（2026-08-28）：同一行里还写着 API 层的死因，此前没解出来。
//   {"type":"result","is_error":true,"stop_reason":"stop_sequence","num_turns":1,
//    "is_api_error_message":true,"error":"authentication_failed","terminal_reason":"api_error"}
// 认证挂掉的那一趟同样是 stop_sequence、同样带 num_turns——只是等于 1，而且四秒就退。
// 只看 (stop_reason, num_turns) 会把它读成「回合数用光」，于是回执教人去调大回合上限；
// 而回合上限调到 800 也还是四秒挂掉。**API 错的那三个字段优先级高于回合数**：
// terminal_reason 说的是这一趟为什么终止，回合数只是顺带的计数。

// error 字段各版本形状不一：有时是字符串，有时是 {type,message}。取一个能印出来的名字。
function 错名于(e) {
  if (!e) return null;
  if (typeof e === 'string') return e.trim() || null;
  if (typeof e === 'object') {
    const s = e.type || e.code || e.name || e.message;
    return typeof s === 'string' && s.trim() ? s.trim() : null;
  }
  return null;
}

function 抽收尾(输出, 格式) {
  const 原 = String(输出 || '');
  if (格式 !== 'claude-stream-json') return null;      // 只认已知形状，不替别的厂商猜
  const 行 = 原.split(/\r?\n/).filter((l) => l.trim());
  for (let i = 行.length - 1; i >= 0; i--) {           // 从后往前找：result 是最后一条
    let o = null;
    try { o = JSON.parse(行[i]); } catch { continue; }
    if (!o || o.type !== 'result') continue;
    const 回合 = Number(o.num_turns);
    return {
      是错: o.is_error === true,
      子类: o.subtype || null,
      停因: o.stop_reason || null,
      回合数: Number.isFinite(回合) ? 回合 : null,
      api毫秒: Number(o.duration_api_ms) || null,
      // API 层的死因。比 (stop_reason, num_turns) 靠谱得多——
      // 后者在认证失败时长得跟「回合数用光」一模一样。
      终因: o.terminal_reason || null,                 // completed / api_error / …
      是api错: o.is_api_error_message === true,
      错名: 错名于(o.error),                            // "authentication_failed" 之类
      api状态: o.api_error_status != null ? o.api_error_status : null,
      // 订阅池跑一次不产生新开销（协-008 的口径），但 CLI 照样报一个名义金额。
      // 原样带出来当**规模的量度**，别把它当账单——它不是。
      名义成本美元: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
    };
  }
  return null;
}

// 把收尾事件翻成一句人话的失败原因。翻不出来就返回 null，让调用方沿用原来的说法——
// **猜错原因比不说原因更坏**：它会把人送到错误的方向上去查。
function 收尾说因(收尾) {
  if (!收尾 || !收尾.是错) return null;
  const 秒 = Math.round((收尾.api毫秒 || 0) / 1000);

  // ① API 层先判。认证失败的那一趟也是 stop_sequence + 带 num_turns，
  //    先看回合数就会把它说成「回合数上限被截断」——而那条建议（调大上限 / 拆小单）
  //    在认证挂掉时一条都不成立。
  if (收尾.是api错 || 收尾.终因 === 'api_error' || 收尾.错名) {
    const 名 = 收尾.错名 || '未具名';
    const 尾 = `（error=${名}${收尾.api状态 != null ? `，HTTP ${收尾.api状态}` : ''}`
      + `${收尾.终因 ? `，terminal_reason=${收尾.终因}` : ''}，${秒}s 就退）`;
    if (/auth|credential|unauthorized|401|403/i.test(名) || 收尾.api状态 === 401 || 收尾.api状态 === 403) {
      return `**API 认证失败**${尾}——CLI 这一侧根本没跑起来，跟单子大小、回合上限都无关。`
        + '去查这个池的登录态/密钥（重新登录或换池），别改单。';
    }
    if (/rate|quota|limit|overload|429/i.test(名) || 收尾.api状态 === 429) {
      return `**API 被限流或额度用尽**${尾}——不是活干砸了。等窗口或换池，原样重跑即可。`;
    }
    return `**API 出错收场**${尾}——照 error 的名字去查这个池，别按「活干砸了」处理。`;
  }

  // ② 回合数上限。只有真绕了好几圈才配这么说：num_turns=1 意味着它连第二轮都没开始，
  //    那不是「上限用光」，是开头就死了——原因得另找，硬套上限会把人送到错误的方向上去。
  if (收尾.停因 === 'stop_sequence' && 收尾.回合数 != null && 收尾.回合数 > 1) {
    return `跑到**回合数上限**被截断（${收尾.回合数} 轮，API 用时 ${秒}s）`
      + '——活没干完，不是干砸了。要么调大回合上限，要么把这张单拆小。';
  }

  if (收尾.停因) {
    return `CLI 报错收场（stop_reason=${收尾.停因}${收尾.回合数 != null ? `，${收尾.回合数} 轮` : ''}`
      + `${收尾.终因 && 收尾.终因 !== 'completed' ? `，terminal_reason=${收尾.终因}` : ''}，${秒}s）`
      + (收尾.回合数 === 1 ? '——只跑了 1 轮就退，不是回合数用光；去翻流水开头那几行。' : '');
  }
  return `CLI 自报 is_error${收尾.子类 ? `（subtype=${收尾.子类}）` : ''}`;
}

module.exports = { 抽正文, 抽claude, 抽codex, 逐行JSON, 抽收尾, 收尾说因, 错名于 };
