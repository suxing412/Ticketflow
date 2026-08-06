// dialogscan.js — 原生对话框 API 扫描（施工令-012，源：2026-08-07 UI 巡礼 P1）
//
// 案由：Electron 壳内 window.prompt / confirm / alert 是哑弹——`typeof window.prompt` 报
// "function"（假在位），真调抛 "prompt() is and will not be supported."。调用点若是 async，
// 异常沉进 promise rejection，界面毫无反应、连报错都不给。而浏览器预览一切正常，
// 于是「预览过、exe 死」反复复发：2026-08-06 confirm 族十处换装，prompt 族四处漏网。
//
// 因此把 grep 变成开机自检的一项：生产前端代码里这三个 API 应为零命中，
// 确认门走自绘 ask()、输入框走自绘 askInput()。
//
// 扫描口径（宁可漏报不可错报，自检项误伤会被当噪声忽略）：
//   · 注释一律不算——含跨行块注释的中间行（坑档案与修法注释里必然写到这几个词，
//     本文件第一版就栽在这：自己写的多行注释把自己报成了红灯）
//   · 行尾 // 注释先剥掉，但放过 http:// 这类协议斜杠
//   · 前缀是 . 或标识符字符的不算（x.confirm() 是别人的方法，askprompt 不是 prompt）
//   · window.prompt(...) 这种显式全局调用照样命中

const RE = /(?<![\w.$])(?:window\.|globalThis\.|self\.)?(prompt|confirm|alert)\s*\(/g;

// 逐行剥注释，返回与源等长的「只剩代码」数组（跨行块注释按状态机吃掉）
function strip(src) {
  const out = [];
  let inBlock = false;
  for (const raw of String(src == null ? '' : src).split(/\r?\n/)) {
    if (/^\s*\*/.test(raw)) { out.push(''); continue; } // jsdoc 续行：代码行不可能以 * 开头
    let rest = raw, code = '';
    for (;;) {
      if (inBlock) {
        const e = rest.indexOf('*/');
        if (e < 0) { rest = ''; break; }
        inBlock = false; rest = rest.slice(e + 2); continue;
      }
      const s = rest.indexOf('/*');
      const l = rest.search(/(^|[^:/])\/\//);
      if (s >= 0 && (l < 0 || s < l)) { code += rest.slice(0, s); rest = rest.slice(s + 2); inBlock = true; continue; }
      code += rest.replace(/(^|[^:/])\/\/.*$/, '$1'); rest = ''; break;
    }
    out.push(code);
  }
  return out;
}

// 返回命中列表：[{ 行: 1-based, api: 'prompt', 文本: 该行 trim 后前 120 字 }]
function scan(src, opts) {
  const 文件 = (opts || {}).文件 || '';
  const raws = String(src == null ? '' : src).split(/\r?\n/);
  const hits = [];
  strip(src).forEach((line, i) => {
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(line))) hits.push({ 文件, 行: i + 1, api: m[1], 文本: raws[i].trim().slice(0, 120) });
  });
  return hits;
}

// 自检用一句话结论：零命中→null；有命中→人读串（最多列 5 处）
function 摘要(hits) {
  if (!hits || !hits.length) return null;
  const head = hits.slice(0, 5).map((h) => `${h.文件 ? h.文件 + ':' : ''}${h.行} ${h.api}()`).join('、');
  return head + (hits.length > 5 ? ` 等 ${hits.length} 处` : '');
}

module.exports = { scan, 摘要, strip };
