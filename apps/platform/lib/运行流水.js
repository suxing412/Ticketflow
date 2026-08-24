// 运行流水 —— 每一次真跑，agent 说的话都留下来（协-028）。
//
// 此前这些字节的下场是：`拉起()` 把 stdout 攒进一个内存字符串，回调用完就**扔了**。
// 只有两处例外——判官的正文进了 fm.质检意见，只读单的报告进了工单正文。
// 代码单跑完之后，「它到底跑了哪些命令、退出码多少、改之前它怎么想的」一个字都不剩。
//
// 两件事因此做不成：
//   ① **同步看它在生成什么**。人问「它还在跑吗」，最好的答案不是一个转圈图标，
//      是**正在往外吐的那几行**。而要有那几行，就得边跑边落盘。
//   ② **判官要的证据**。2026-08-24 HW-4 第三轮判不过，理由是「交付材料中没有回执，
//      未提供三条命令的原始输出及退出码」——那些输出 agent 明明打过，是平台丢的。
//
// 形制：一次运行两个文件，同目录同名。
//   journal/运行/<单号>/<运行号>.log    原始流（append-only，逐块落）
//   journal/运行/<单号>/<运行号>.json   元数据（起于/讫于/类别/池/退出码/结论…）
// 运行号 = `<紧凑时刻>-<类别>`，天然有序、天然可读、天然不撞（同一秒内同一单不会有两次）。
//
// 为什么原始流而不是「解析好的正文」：原始流是**证据**，解析是**看法**。
// 各家 CLI 的格式会变，解析随时可能抽错；抽错了还能回头看原文，原文丢了就什么都没有。
// 给人看的那一版在读的时候现渲染（见 渲染()），不落第二份盘。
'use strict';

const fs = require('fs');
const path = require('path');

const 运行根 = (账本根) => path.join(账本根, 'journal', '运行');
const 单目录 = (账本根, 单) => path.join(运行根(账本根), 安全名(单));
const 流水文件 = (账本根, 单, 运行号) => path.join(单目录(账本根, 单), `${安全名(运行号)}.log`);
const 元文件 = (账本根, 单, 运行号) => path.join(单目录(账本根, 单), `${安全名(运行号)}.json`);

// 单号与运行号都会进文件路径。工单编号是人取的，`../` 这种东西不该有机会落到 fs 上。
// 只剥分隔符不够：剥完之后 `..` 本身仍是个能上跳一级的名字（`path.join(dir, '..')`）。
// 所以纯点号的名字一律换掉——这类名字没有正常用途，而它是唯一一个「看着已经安全了」
// 却仍然能逃出去的形状。中文单号必须原样留：这个仓的单号常态就是中文。
const 安全名 = (s) => {
  const 清 = String(s || '').replace(/[^\w.\-一-龥]+/g, '_').slice(0, 80);
  return (!清 || /^\.+$/.test(清)) ? '_' : 清;
};

// 单次运行的落盘上限。stream-json 极啰嗦——一次十分钟的真跑轻松几十 MB，
// 而这些文件会被接口整份读进内存。超了就停止追加并在末尾留一行明说，
// **不是静默截断**：一份看起来完整、实际缺了后半截的证据比没有证据更坏。
const 默认上限字节 = 24 * 1024 * 1024;

function 紧凑时刻(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 开一次运行：建目录、写元数据、返回运行号。失败返回 null（落不了盘不该打断真跑）。 */
function 开始(账本根, { 单, 类别, 池, 模型, 干跑, 格式 } = {}) {
  try {
    const 运行号 = `${紧凑时刻(new Date())}-${安全名(类别 || '执行')}`;
    fs.mkdirSync(单目录(账本根, 单), { recursive: true });
    fs.writeFileSync(元文件(账本根, 单, 运行号), JSON.stringify({
      运行号, 单, 类别: 类别 || '执行', 池: 池 || null, 模型: 模型 || null,
      // 格式要记下来：渲染是在**读**的时候做的，那时早已没有 调用 对象了。
      // 不记的话只能靠池名猜，而池名是人起的（拓扑事实④那条坑）。
      格式: 格式 || null,
      干跑: !!干跑, 起于: new Date().toISOString(), 讫于: null, 退出码: null, 结论: null,
    }, null, 2) + '\n', 'utf8');
    fs.writeFileSync(流水文件(账本根, 单, 运行号), '', 'utf8');
    return 运行号;
  } catch { return null; }
}

/** 落一块。**绝不抛**——落盘失败不该把正在跑的活打断，最多是这一次没有证据。 */
function 落(账本根, 单, 运行号, 块) {
  if (!运行号) return;
  try {
    const f = 流水文件(账本根, 单, 运行号);
    let 大小 = 0;
    try { 大小 = fs.statSync(f).size; } catch { /* 还没有就当 0 */ }
    if (大小 >= 默认上限字节) return;
    let 文 = String(块 || '');
    if (大小 + Buffer.byteLength(文) >= 默认上限字节) {
      文 += `\n[运行流水] 已达单次上限 ${Math.round(默认上限字节 / 1048576)}MB，后续输出不再落盘。`
        + '这一行是明说，不是静默截断——一份看起来完整、实际缺了后半截的证据比没有证据更坏。\n';
    }
    fs.appendFileSync(f, 文, 'utf8');
  } catch { /* 见上 */ }
}

/** 收尾：把结果写回元数据。 */
function 收尾(账本根, 单, 运行号, 结果 = {}) {
  if (!运行号) return;
  try {
    const f = 元文件(账本根, 单, 运行号);
    const 元 = JSON.parse(fs.readFileSync(f, 'utf8'));
    let 字节 = 0;
    try { 字节 = fs.statSync(流水文件(账本根, 单, 运行号)).size; } catch { /* 没有就 0 */ }
    fs.writeFileSync(f, JSON.stringify({
      ...元, 讫于: new Date().toISOString(), 字节, ...结果,
    }, null, 2) + '\n', 'utf8');
  } catch { /* 同上 */ }
}

/** 这张单跑过几次：元数据列表，新的在前。 */
function 列(账本根, 单) {
  let 名 = [];
  try { 名 = fs.readdirSync(单目录(账本根, 单)).filter((x) => x.endsWith('.json')); } catch { return []; }
  const 出 = [];
  for (const n of 名) {
    try { 出.push(JSON.parse(fs.readFileSync(path.join(单目录(账本根, 单), n), 'utf8'))); } catch { /* 坏的跳过 */ }
  }
  return 出.sort((a, b) => String(b.运行号).localeCompare(String(a.运行号)));
}

/**
 * 增量读一段流水。
 * @param from 上次读到的字节偏移。**按字节不按行**：调用方要轮询续读，行号会因为半行而错位。
 * @returns { 内容, 起, 讫, 大小, 还在跑 }
 */
function 读(账本根, 单, 运行号, from = 0, 上限 = 256 * 1024) {
  const f = 流水文件(账本根, 单, 运行号);
  let 大小 = 0;
  try { 大小 = fs.statSync(f).size; } catch { return { 内容: '', 起: 0, 讫: 0, 大小: 0, 缺失: true }; }
  const 起 = Math.max(0, Math.min(Number(from) || 0, 大小));
  const 长 = Math.max(0, Math.min(上限, 大小 - 起));
  let 内容 = '';
  if (长 > 0) {
    try {
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(长);
      fs.readSync(fd, buf, 0, 长, 起);
      fs.closeSync(fd);
      内容 = buf.toString('utf8');
    } catch { /* 读不着就当空 */ }
  }
  return { 内容, 起, 讫: 起 + 长, 大小 };
}

/* ===================== 渲染：给人看的那一版 =====================
 * 原始流是证据，这里是看法——**在读的时候现算，不落第二份盘**。
 * 格式会变，解析随时可能抽错；抽错了还能回头看原文，原文丢了就什么都没有。
 *
 * 渲染成「一行一件事」：agent 说的话原样出，工具调用压成一行摘要。
 * 不这么压的话，一次真跑的流里 95% 是 input_json_delta 那种逐字符的碎片，
 * 人在里面找不到自己要看的东西。 */
function 渲染(内容, 格式) {
  const 行 = String(内容 || '').split(/\r?\n/);
  const 出 = [];
  for (const l of 行) {
    const s = l.trim();
    if (!s) continue;
    if (s[0] !== '{') { 出.push(s); continue; }          // 非 JSON 行（日志/告警）原样留
    let o = null;
    try { o = JSON.parse(s); } catch { continue; }        // 半行（正读到一半）跳过，下次补上
    if (格式 === 'codex-jsonl') {
      const it = o.item;
      if (o.type === 'item.completed' && it) {
        if (it.type === 'agent_message' && it.text) 出.push(it.text);
        else if (it.type === 'command_execution') 出.push(`▸ 跑 ${String(it.command || '').slice(0, 160)}`);
        else if (it.type) 出.push(`▸ ${it.type}`);
      }
      continue;
    }
    // claude-stream-json
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (c && c.type === 'text' && String(c.text || '').trim()) 出.push(c.text);
        else if (c && c.type === 'tool_use') 出.push(`▸ ${c.name}(${摘参(c.input)})`);
      }
    } else if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (c && c.type === 'tool_result') {
          const 文 = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
          出.push(`  ↳ ${String(文).replace(/\s+/g, ' ').slice(0, 200)}`);
        }
      }
    } else if (o.type === 'result') {
      出.push(`— 收尾：${o.is_error ? '出错' : '正常'}`
        + (o.num_turns != null ? ` · ${o.num_turns} 轮` : '')
        + (o.stop_reason ? ` · stop_reason=${o.stop_reason}` : '')
        + (o.duration_api_ms ? ` · API ${Math.round(o.duration_api_ms / 1000)}s` : ''));
    }
  }
  return 出.join('\n');
}

function 摘参(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['file_path', 'path', 'command', 'pattern', 'url']) {
    if (input[k]) return String(input[k]).replace(/\s+/g, ' ').slice(0, 120);
  }
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}

module.exports = { 运行根, 单目录, 流水文件, 元文件, 开始, 落, 收尾, 列, 读, 渲染, 安全名, 默认上限字节 };
