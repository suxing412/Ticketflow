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

// ——— 子进程起不来（2026-08-28 HW-9 实测）———
//
// codex 的沙箱 helper 在这台机器上突然给每一次 exec 都判了拒绝：
//   ERROR codex_core::tools::router: error=exec_command failed for `"…powershell.exe" -Command Get-Location`:
//     CreateProcess { message: "Rejected(\"Failed to create unified exec process: helper_unknown_error: apply deny-read ACLs\")" }
// PowerShell、cmd.exe、Git Bash 三种壳全中，**都是启动前失败**，不是命令本身报错。
// 后果是 agent 读不到任何文件、跑不了任何命令，却照样输出了一段完整的结论——
// 而**进程退出码是 0**。也就是说：
//   · 执行侧：加固.成败判定 看退出码 0 + 有输出 → 记成功，一次零证据的空跑被当成干完了；
//   · 质检侧：判官这次说了「验不了」所以没出事，但它同样可能说「不过」或「通过」，
//     那就是拿零证据把一张好单打回、或者把一张坏单放行。
// 这不是模型的问题，模型工作正常；坏的只有子进程创建。所以判据不能问模型，要问**流水**：
// 这一趟到底有没有一条命令真的跑起来过。
//
// 只认两个通道，**不看 agent 自己说的话**：agent_message 里常常原样引用这句错误
// （HW-9 的判词第一条就是），拿它当判据等于「谁提到这个错谁就算故障」。
//   ① JSONL 里的 command_execution 事件：aggregated_output 带 helper 字样的算起不来；
//   ② stderr 里 codex router 的 exec_command failed 行。
const 起不来标记 = /Failed to create unified exec process|helper_unknown_error|orchestrator_helper_launch_failed|windows sandbox:|CreateProcess \{/i;

// 从一段错误文本里取一个能印的死因名。取不到就原样截一段——别返回空，
// 空会让上游把「起不来」印成一句没有内容的话。
function 死因于(文) {
  const s = String(文 || '');
  const m = s.match(/(helper_unknown_error[^"\)]*|orchestrator_helper_launch_failed[^"\,]*|windows sandbox:\s*[a-z_]+)/i);
  // 尾巴上常挂着 Rust 那串转义的收尾（`ACLs\")`），原样印出来像是死因的一部分。
  return (m ? m[1] : s.split(/\r?\n/)[0] || '').replace(/[\\"\s]+$/, '').trim().slice(0, 200) || null;
}

function 抽进程故障(输出, 错出) {
  const 起不来 = []; const 见过 = new Set(); let 跑起来了 = 0;
  const 记 = (命令, 因) => {
    const 键 = String(命令 || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (键 && 见过.has(键)) return;                    // stderr 与 JSONL 常常说的是同一次
    if (键) 见过.add(键);
    起不来.push({ 命令: 键.slice(0, 200), 因: 死因于(因) });
  };

  for (const 行 of String(输出 || '').split(/\r?\n/)) {
    const s = 行.trim();
    if (!s || s[0] !== '{') continue;
    let e = null;
    try { e = JSON.parse(s); } catch { continue; }
    const it = e && e.item;
    if (!it || it.type !== 'command_execution' || e.type !== 'item.completed') continue;
    const 出 = String(it.aggregated_output || '');
    if (起不来标记.test(出)) 记(it.command, 出);
    else 跑起来了 += 1;                                 // 真跑过——退出码非 0 也算跑过，那是命令自己的事
  }

  // stderr：这一路里 codex 把连 item 都没建起来的失败也印了出来（HW-9 就是这种，
  // 四次调用一个 command_execution 事件都没有）。不读它就等于这一趟看上去「一条命令都没调用过」。
  for (const 行 of String(错出 || '').split(/\r?\n/)) {
    const s = 行.replace(/^\[stderr\]\s*/, '');
    if (!/exec_command failed for/.test(s) || !起不来标记.test(s)) continue;
    const m = s.match(/exec_command failed for `([\s\S]*?)`:/);
    记(m ? m[1] : '(命令未记录)', s);
  }

  if (!起不来.length) return null;
  return {
    起不来: 起不来.length,
    跑起来了,
    全灭: 跑起来了 === 0,                               // 一条都没跑起来 = 这一趟的结论建立在零证据上
    死因: 起不来[0].因,
    例: 起不来.slice(0, 3),
  };
}

// 翻成一句人话。**全灭与偶发要分开说**：偶发一条命令起不来是噪声，
// 全灭意味着这一趟根本没有证据——两者的处置完全不同。
function 进程故障说因(故障) {
  if (!故障) return null;
  const 例 = 故障.例.map((e) => `  - ${e.命令}`).join('\n');
  if (!故障.全灭) {
    return `⚠ 这一趟有 ${故障.起不来} 次命令**没能起进程**（${故障.死因 || '死因不明'}），`
      + `另有 ${故障.跑起来了} 次跑起来了。结论未必受影响，但证据是缺的一块：\n${例}`;
  }
  return `**沙箱起不了子进程**：这一趟 ${故障.起不来} 次命令调用全部在**进程创建阶段**失败`
    + `（${故障.死因 || '死因不明'}），一条都没跑起来。\n${例}\n`
    + 'agent 读不到文件、跑不了命令，**它这次说的任何结论都建立在零证据上**——'
    + '而 CLI 的退出码仍是 0，光看退出码会把它当成一次成功。\n'
    + '这不是被评审方的问题，也不是模型的问题（模型正常出话），坏的是执行环境：'
    + '去查 codex 的沙箱 helper（Windows ACL / 杀软策略 / 组策略在这台机器上的变化），'
    + '或把这个角色暂时派给别家。**改沙箱档位没用**——失败在进程创建，不在写权限。';
}

// ——— 写不了（2026-08-28 HW-2 实测）———
//
// 判官报「验不了」时，平台此前只会给一句猜测：「多半是工单要声明 需要依赖」。
// 这次的实际病因是**审阅区里写不了**：
//   EPERM: operation not permitted, mkdir '…\审阅-HW-2\tooling\node_modules\.vite-temp'
// 补依赖补一百遍也没用——包全在，是权限。把人送去查 需要依赖 是把他送反方向，
// 而这条错自己已经把病因和现场路径都写在脸上了，只是没人读。
//
// 跟「起不来」（协-035，进程创建阶段失败）分开：那条是一条命令都跑不起来，
// 这条是命令跑起来了、跑到一半写不动。两者的处置不同，不能混成一句「环境阻断」。
const 写权码 = /\b(EPERM|EACCES)\b[^\n]{0,200}/g;
const 写权动作 = /operation not permitted|permission denied|拒绝访问|Access is denied/i;

function 抽写权阻断(输出, 区路径) {
  const 例 = []; const 见过 = new Set();
  const 区 = String(区路径 || '').replace(/\\/g, '/').toLowerCase();
  for (const 行 of String(输出 || '').split(/\r?\n/)) {
    const s = 行.trim();
    if (!s || s[0] !== '{') continue;
    let e = null;
    try { e = JSON.parse(s); } catch { continue; }
    const it = e && e.item;
    if (!it || it.type !== 'command_execution' || e.type !== 'item.completed') continue;
    const 出 = String(it.aggregated_output || '');
    for (const m of 出.match(写权码) || []) {
      if (!写权动作.test(m)) continue;                  // 光出现 EPERM 三个字母不算（判词里常引用）
      const 路径 = (m.match(/'([^']{3,300})'/) || [])[1] || null;
      const 键 = (路径 || m).slice(0, 300);
      if (见过.has(键)) continue;
      见过.add(键);
      例.push({
        命令: String(it.command || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        路径,
        说: m.trim().slice(0, 200),
        区内: !!(区 && 路径 && 路径.replace(/\\/g, '/').toLowerCase().startsWith(区)),
      });
    }
  }
  if (!例.length) return null;
  return { 次数: 例.length, 区内: 例.filter((e) => e.区内).length, 例: 例.slice(0, 3) };
}

function 写权阻断说因(阻断) {
  if (!阻断) return null;
  const 例 = 阻断.例.map((e) => `  - ${e.路径 || e.说}${e.命令 ? `\n    （${e.命令}）` : ''}`).join('\n');
  return `**写不了，不是缺依赖**：这一趟有 ${阻断.次数} 处命令因为权限被拒（EPERM/EACCES），`
    + `其中 ${阻断.区内} 处就落在审阅区里：\n${例}\n`
    + '包是齐的——补 需要依赖 对这条毫无作用。要查的是审阅区的写权：\n'
    + '  · Windows 上 codex 的 workspace-write 是靠 ACL 实现的，'
    + '**新建的大目录树第一次进沙箱时授权可能没落上**（协-036 已在建审阅区时预授一次，'
    + '看回执里的 `沙箱写权`：ok:false 就是没授上）；\n'
    + '  · 也可能是判官这次压根没拿到「区内可写」（看回执里的 判官模式，'
    + '「只读」时 tsc 写不了 dist、vitest 写不了 .vite-temp，命令型验收必然验不了）。';
}

module.exports = {
  抽正文, 抽claude, 抽codex, 逐行JSON, 抽收尾, 收尾说因, 错名于,
  抽进程故障, 进程故障说因, 抽写权阻断, 写权阻断说因,
};
