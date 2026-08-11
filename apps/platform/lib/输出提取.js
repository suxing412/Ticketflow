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

module.exports = { 抽正文, 抽claude, 抽codex, 逐行JSON };
