// lifecycle.js — 高层生命周期动作（D5/D6/D8/D10/D13 · H108 三大态状态机改造 2026-08-24）。
// 每个动作 = 一次合法状态转移 + 记账。只做控制流；产出资产由执行 agent 写进项目仓库，回执写进 回执/。
// 新边表以 core/store.js TRANSITIONS 为准；本文件是全部转移边的唯一写口，逐条注明旧边来源。
const fs = require('fs');
const path = require('path');
const store = require('./core/store');
const journal = require('./journal');
const inbox = require('./inbox');

const nowIso = () => new Date().toISOString();

// 上呈原因落库（施工令-012 / 巡礼 P2-3，通则见「优化-D」）：凡是要端到制作人面前当判断依据的
// 结论，一律在流转时写进 frontmatter，前端只读字段——不再靠 grep 流水回答一个本该有字段的问题。
const 记上呈原因 = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);

// 审过（原 定稿 草稿→待投）：待审→待派。语义=总监审核通过，等排期与派发。
function 审过(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待审') return { ok: false, error: `只有待审单可审过（当前 ${t.state}）` };
  const r = store.move(root, id, '待审', '待派', null, nowIso());
  if (r.ok) journal.append(root, `审过 ${id}（待审→待派 · 总监审核通过）`);
  return r;
}

// 放行（原 投池 待投→池 的退役形态）：池并入待派后，放行不再是目录跳变，
// 而是待派单上的 fm 标记——fm.放行=true（人闸释放，D2/H109 项管闸的凭据位）。
// 【口径·供 B 组接线（pool.js 不归本文件改）】：pool/派发只领「待派目录里 fm.放行===true」的单；
// fm.放行 缺失或 false 一律不领。待重派单的领取口径由 B 组按 H113 另定（重投 会带 放行=true 过去）。
function 放行(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待派') return { ok: false, error: `只有待派单可放行（当前 ${t.state}）` };
  if (t.fm.放行 === true) return { ok: false, error: '该单已放行' };
  // 停靠单不许放行：停靠就是「等一个人的决定」，绕过它开闸正是 2026-08-26 两次职权对冲的形态。
  // 要放行先显式 解除停靠——让「我知道它停着而我决定放它走」成为一个留痕的动作。
  if (t.fm.停靠 === true) {
    return { ok: false, error: `该单已停靠，须先解除停靠：${String(t.fm.停靠因 || '').slice(0, 80)}` };
  }
  const r = store.update(root, id, (fm) => { fm.放行 = true; }, nowIso());
  if (r.ok) journal.append(root, `放行 ${id}（待派原地落 fm.放行=true · 人闸）`);
  // H116 对称同步：放行时粒若已有计划（先排后放的顺序），此刻补迁 已排期——
  // 排期侧的桥只在排期落账时跑，放行晚于排期的路要在这儿接上。
  if (r.ok && t.fm.粒ID) {
    try {
      const S = require('./pm/schedule');
      const g = S.取(root, String(t.fm.粒ID));
      if (g) S.同步已排期态(root, g);
    } catch { /* 同步失败不拖垮放行——G 闸巡账兜底 */ }
  }
  return r;
}

// 撤回放行：收回人闸释放，单不动窝（待派原地 fm.放行=false）。
function 撤回放行(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待派') return { ok: false, error: `只有待派单可撤回放行（当前 ${t.state}）` };
  if (t.fm.放行 !== true) return { ok: false, error: '该单未放行' };
  const r = store.update(root, id, (fm) => { fm.放行 = false; }, nowIso());
  if (r.ok) journal.append(root, `撤回放行 ${id}（待派原地 fm.放行=false）`);
  return r;
}

// ---- 停靠（H33 议程第 33 条，2026-08-27 制作人拍板）----
//
// 「停靠」＝**故意把一张单摁住，等一个人的决定**，与「还没轮到放行」是两回事。
// 在此之前它只是流水散文里的人工语义，代码里不存在——一个缺失的标记派生出四个方向相反的症状：
//   ① 项管裁决 adjudicateReferral 自动带放行，把总监刚停靠的单重新开闸
//      （2026-08-26 实测两次同分钟对冲：TK-187 16:51/16:52、TK-207 18:17/18:18）
//   ② 排期把停靠单的粒照排不误（08-27 今夜十一粒里九粒挂在停靠单上，复判还反复挪动它们）
//   ③ G1「派发放行」把停靠单算成项管欠债并逾期告警——**误报**，因为开闸恰恰是错的
//   ④ patrol 零派发狗因就绪队列空而静默——**漏报**（③④同源反向）
//
// 停靠 ≠ 挂起：挂起是冻结在途会话（fm.挂起，看门狗全线回避）；停靠只作用于待派单，
// 单还在队列里、还看得见，只是不许任何自动化把它推上产线。
function 停靠(root, id, 因) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待派') return { ok: false, error: `只有待派单可停靠（当前 ${t.state}）` };
  if (t.fm.停靠 === true) return { ok: false, error: '该单已停靠' };
  const 由 = String(因 || '').trim();
  // 因由必填：一张停不明不白的单，跟一张被遗忘的单在后果上是同一件事
  if (!由) return { ok: false, error: '停靠须给因由（停靠是等人决定，不写等谁决定什么就是把单藏起来）' };
  const r = store.update(root, id, (fm) => {
    fm.停靠 = true; fm.停靠因 = 由.slice(0, 200); fm.停靠自 = nowIso();
    fm.放行 = false;   // 停靠必然含撤放行：两者同时为真是自相矛盾的状态
  }, nowIso());
  if (r.ok) journal.append(root, `停靠 ${id}（待派原地 fm.停靠=true · 候人裁）：${由.slice(0, 120)}`);
  return r;
}

// 解除停靠：把单放回自动化的视野。解除不等于放行——放行仍是 G1 项管闸另一道手续。
function 解除停靠(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.fm.停靠 !== true) return { ok: false, error: '该单未停靠' };
  const r = store.update(root, id, (fm) => {
    delete fm.停靠; delete fm.停靠因; delete fm.停靠自;
  }, nowIso());
  if (r.ok) journal.append(root, `解除停靠 ${id}（回自动化视野；放行仍需 G1 另判）`);
  return r;
}

// 判读口径统一走这里：严判 === true，沿用 G1 对 fm.放行 的同一条纪律
// （字符串 'true'/1 这类脏值一律当没停靠——宁可多推一张，不可把一张单静默藏起来）。
const 已停靠 = (t) => !!(t && t.fm && t.fm.停靠 === true);

// 交产出：执行完工〔原 在途→质检(QA开)/待验收(QA关)〕⇒ 在途→初检(QA开)/核查(QA关·简检)/完成(免检保留单)。
// 回执写入 回执/<id>.md（含 QA 章节，若开）。
function 交产出(root, id, 回执body) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '在途') return { ok: false, error: `只有在途单可交产出（当前 ${t.state}）` };
  if (t.fm.待复核) return { ok: false, error: `待复核未解除（上游 ${t.fm.待复核.锚号 || ''} 已改版），核对新版后先解除标记（D36）` };
  // 旧 fm.挂起 标记残留守卫（施工令-021 遗形）：挂起已升格目录态（存量标记迁移由总控做），
  // 迁移完成前老单可能还带着 fm.挂起 印停在在途——残留会话不得把冻结单顶走。迁移收尾后此守卫可拆。
  if (t.fm.挂起) return { ok: false, error: '该单带旧制挂起标记（待迁移至挂起目录），解冻后才能交产出' };
  if (回执body) {
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    const rp = path.join(root, '回执', `${id}.md`);
    const 轮 = t.fm.返修轮 || 0;
    // H65 同活同号：返修轮次的回执分节追加，历史不覆盖
    if (轮 > 0 && fs.existsSync(rp)) fs.appendFileSync(rp, `\n\n---\n## 第 ${轮 + 1} 轮回执（返修后）\n\n${回执body}`, 'utf8');
    else fs.writeFileSync(rp, 回执body, 'utf8');
  }
  const qaOn = String(t.fm.QA || '').trim() !== '关'; // fail-closed（2026-08-05 TK-84 案：非标 QA 串一律按开判）
  // 免检=双钥匙：fm.免检 明标 且 验收方式=保留（制作人亲验）。只标免检不标保留的单照走审检链——fail-closed 向严。
  const 免检 = t.fm.免检 === true && String(t.fm.验收方式 || '').trim() === '保留';
  const to = 免检 ? '完成' : (qaOn ? '初检' : '核查');
  const r = store.move(root, id, '在途', to, (fm) => { fm.交付时间 = nowIso(); }, nowIso()); // 交付时刻：执行时间轴的段终点
  if (r.ok) journal.append(root, `交产出 ${id}（在途→${to}${免检 ? ' · 免检保留单直达完成' : (qaOn ? '' : ' · QA关简检')}）`);
  return r;
}

// QA 裁定（D10 · 初检席）：通过→核查〔原 质检→待验收〕；不过且未超自修上限→在途(自修+1)〔原 质检→在途〕；
// 不过且超上限（三振）→待处理〔原 质检→待定夺〕，上呈原因四件套照写。
function QA裁定(root, cfg, id, 通过) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '初检') return { ok: false, error: `只有初检中单可 QA 裁定（当前 ${t.state}）` };
  if (通过) {
    const r = store.move(root, id, '初检', '核查', null, nowIso());
    if (r.ok) journal.append(root, `QA 通过 ${id}（初检→核查）`);
    return r;
  }
  const 上限 = (cfg.闸值 || {}).QA自修上限 ?? 2;
  const c = (Number(t.fm.自修次数) || 0) + 1;
  if (c <= 上限) {
    const r = store.move(root, id, '初检', '在途', (fm) => { fm.自修次数 = c; }, nowIso());
    if (r.ok) journal.append(root, `QA 不过自修 ${id} 第 ${c}/${上限} 轮（初检→在途）`);
    return r;
  }
  const r = store.move(root, id, '初检', '待处理', (fm) => {
    fm.自修次数 = c; fm.上呈原因 = 记上呈原因(`QA 自修 ${c} 轮仍未过（上限 ${上限}）→ 三振上呈，四件套待裁`);
  }, nowIso());
  if (r.ok) { journal.append(root, `QA 修不好 ${id} → 待处理（初检三振 · 四件套呈总监分诊）`); inbox.post(root, '急', '三振上呈', `${id} QA 修不好，四件套待裁`, { 单号: id }); }
  return r;
}

// ---- 审检链后半段（H108 新边 · lifecycle 提供函数，runner 组接线）----
// 核查过：核查→完成〔原 质检→待验收〕。完成=在途出口驻留位，未经验收（判官过而已），等专项级验收。
function 核查过(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '核查') return { ok: false, error: `只有核查中单可核查过（当前 ${t.state}）` };
  const r = store.move(root, id, '核查', '完成', null, nowIso());
  if (r.ok) journal.append(root, `核查过 ${id}（核查→完成 · 判官全过，驻留等验收）`);
  return r;
}

// 核查打回：核查→在途，回炉自修（2026-08-28 TF-15 案）。
//
// 为什么非补不可：初检判「不过」时 runner 只写 fm.初检 与一行流水「留核查（返修或人工裁）」，
// 单**原地留在核查**。而深检挑单要求 `fm.初检.结论 === '过'`，初检本身又只挑 `!fm.初检` 的单——
// 于是初检一旦不过，这张单**既不会被深检捡走、也不会被初检重判**，永远蹲在核查里。
// 流水许诺的「返修或人工裁」两条路当时一条都不存在：核查态对外只暴露了 实证放行
// （还要求已盖 H97 候检印），其余出边只有废弃。**闸表宣告了一个点了没反应的按钮**——
// 与 G21「审过/打回」那处同型（打回在待审同样无实现），本次一并按同一取向补上实现。
//
// 章要一起销：初检/代核 两枚章不清，回炉重跑一轮后照旧卡在同一个坑里。
// 自修次数归零同 仲裁定「给方向」的口径（TK-97 案）——回炉是人给的新起点，不清则回来即三振。
// 说明写进正文而不是只落 fm：**执行会话读的是正文**，写进 fm 等于说给自己听。
function 核查打回(root, id, 说明) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '核查') return { ok: false, error: `只有核查中单可打回自修（当前 ${t.state}）` };
  const 由 = String(说明 || '').trim();
  if (!由) return { ok: false, error: '打回须给说明——不说为什么打回，回炉那一轮只能靠猜' };
  const r = store.move(root, id, '核查', '在途', (fm) => {
    delete fm.初检; delete fm.代核;   // 章不销，回炉后照旧卡在同一个坑
    fm.自修次数 = 0;
  }, nowIso());
  if (!r.ok) return r;
  store.update(root, id, (fm, t2) => ({
    body: (t2.body || '') + `\n\n## 核查打回（人工 · ${nowIso().slice(0, 10)}）\n${由.slice(0, 2000)}\n`,
  }));
  journal.append(root, `核查打回 ${id}（核查→在途 · 回炉自修 · 初检/代核章已销）：${由.slice(0, 80)}`);
  return r;
}

// 送仲裁：核查有争议→仲裁（H108 新边）。争议因落 frontmatter（优化-D 通则）。
function 送仲裁(root, id, 因) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '核查') return { ok: false, error: `只有核查中单可送仲裁（当前 ${t.state}）` };
  const r = store.move(root, id, '核查', '仲裁', (fm) => {
    fm.仲裁因 = String(因 || '核查争议').replace(/\s+/g, ' ').trim().slice(0, 200);
    delete fm.代裁; // 新一轮裁决：旧裁章随入仲裁销（2026-08-26 TK-197 案：旧章挡代裁挑单，单卡死）
  }, nowIso());
  if (r.ok) journal.append(root, `送仲裁 ${id}（核查→仲裁${因 ? ` · ${String(因).slice(0, 60)}` : ''}）`);
  return r;
}

// 仲裁定：裁过→完成；裁不了上呈→待处理〔原→待定夺〕；打回→在途（按边表补齐，回执重做）。
function 仲裁定(root, id, 决定, 说明) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '仲裁') return { ok: false, error: `只有仲裁中单可裁（当前 ${t.state}）` };
  const map = { 裁过: '完成', 上呈: '待处理', 打回: '在途' };
  const to = map[决定];
  if (!to) return { ok: false, error: `未知决定：${决定}（裁过/上呈/打回）` };
  const patch = 决定 === '上呈'
    ? (fm) => { fm.上呈原因 = 记上呈原因(`仲裁裁不了上呈${t.fm.仲裁因 ? `：${t.fm.仲裁因}` : ''}${说明 ? ` · ${说明}` : ''}——需总监分诊`); }
    // 打回=回炉重做：旧审检章一并销（2026-08-26 TK-197 案：给方向回在途后旧 代核:不过 章残留，
    // 新产出交回核查时被孤儿补链按旧章再送仲裁成循环；章是对上一版产出的判断，回炉即失效）
    : 决定 === '打回' ? (fm) => { delete fm.代核; delete fm.核查; delete fm.初检; delete fm.代裁; } : null; // 代裁 一并销（2026-08-26 仲裁孤儿案）
  const r = store.move(root, id, '仲裁', to, patch, nowIso());
  if (r.ok) {
    journal.append(root, `仲裁定 ${id}：${决定}（仲裁→${to}${说明 ? ` · ${String(说明).slice(0, 60)}` : ''}）`);
    if (决定 === '上呈') inbox.post(root, '急', '仲裁上呈', `${id} 仲裁裁不了，待总监分诊`, { 单号: id });
  }
  return r;
}

// 待处理分诊（D10 · 原 定夺 三出路 待定夺→待验收/在途/已归档）：
// 接受→完成；给方向→待重派（可附方向文本，重派后主办 agent 能读到）；废弃→废弃目录。
// 给方向清计数（2026-08-06 TK-97 六分钟连环三振案）：回炉是裁决给的新起点，不清则重派后
// QA 一次不过即再超上限→秒回待处理，死循环。接受/废弃不动计数。
function 定夺(root, id, 决定, 方向, 裁决人) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待处理') return { ok: false, error: `当前不在待处理（${t.state}）` };
  const map = { 接受: '完成', 给方向: '待重派', 废弃: '废弃' };
  const to = map[决定];
  if (!to) return { ok: false, error: `未知决定：${决定}（接受/给方向/废弃）` };
  const patch = 决定 === '废弃' ? (fm) => { fm.废弃因 = '定夺废弃'; }
    : 决定 === '给方向' ? (fm) => { fm.自修次数 = 0; delete fm.执行池; delete fm.代核; delete fm.核查; delete fm.初检; delete fm.代裁; } : null; // 运行章+全部旧审检章随回炉销（2026-08-26 TK-197/仲裁孤儿两案同判）
  const r = store.move(root, id, '待处理', to, patch, nowIso());
  if (r.ok) {
    if (决定 === '给方向' && 方向) {
      store.update(root, id, (fm, t2) => ({ body: (t2.body || '') + `\n\n## 定夺方向（${裁决人 || '制作人'} · ${nowIso().slice(0, 10)}）\n${String(方向).slice(0, 2000)}\n` }));
    }
    journal.append(root, `待处理分诊 ${id}：${决定}（待处理→${to}${裁决人 ? ' · ' + 裁决人 : ''}）`);
  }
  return r;
}

// 单张验收（D11 · 散单/保留单专用；专项级验收级联另归 C 组）：
// 通过→归档（落袋）〔原 待验收→完成〕；不过→待重派（带返修因）〔原 待验收→已归档+另开新单，DS-1 补边后同号回队〕。
function 验收(root, id, 通过, 因) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '完成') return { ok: false, error: `只有完成单可验收（当前 ${t.state}）` };
  // H69 线③（客观误判事件）：核查说通过而制作人打回=漏判；核查说不过而制作人签通过=误杀
  const 核查章 = t.fm.核查 || t.fm.代核;
  if (核查章 && 核查章.结论) {
    const 误 = !通过 && 核查章.结论 === '通过' ? '漏判' : (通过 && 核查章.结论 === '不过' ? '误杀' : null);
    if (误) { try { require('./pm/ledger').score(root, { 线: '审检误判', 席: '核查', 单: id, 类型: 误 }); } catch { /* 不阻塞 */ } }
  }
  const to = 通过 ? '归档' : '待重派';
  const r = store.move(root, id, '完成', to, (fm) => {
    if (通过) fm.归档原因 = fm.归档原因 || '验收通过';
    else { fm.返修因 = String(因 || '验收不过').replace(/\s+/g, ' ').trim().slice(0, 200); delete fm.执行池; } // 运行章随会话销毁（2026-08-26 评审补：与 specials 验收打回 同判）
    delete fm.待引擎实证; // 走完人闸的单不留失效候检印（施工令-032② 原义顺延）
  }, nowIso());
  if (r.ok) journal.append(root, `验收 ${id}：${通过 ? '通过→归档（落袋）' : `不过→待重派${因 ? `（${String(因).slice(0, 60)}）` : ''}`}`);
  return r;
}

// 撤回：待派→待审〔原 池/待投→草稿〕（还没人领，无副作用；顺手撤放行旗）。
function 撤回(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待派') return { ok: false, error: `只有待派单可撤回（当前 ${t.state}）` };
  const r = store.move(root, id, '待派', '待审', (fm) => { fm.放行 = false; }, nowIso());
  if (r.ok) journal.append(root, `撤回 ${id}（待派→待审 · 撤放行）`);
  return r;
}

// 废弃：→废弃 目录〔原 任意非终态→已归档+归档原因:废弃 的独立化〕。制作人拉闸权。
// 完成单没有废弃边（做完的活翻案走 推翻，收账走 验收）；历史「归档原因:废弃」的单留在归档不重分类（不改史）。
// 依赖悬空扫描：还有哪些未完成单挂着 id 的依赖。废弃与待审打回共用一份——
// 两处各抄一遍就是两把尺，改一处漏一处（本仓白名单吞字段家族的老病）。
// 扫描面=待办五态+审检链在途四态+挂起（挂起会复活，依赖同样会悬空）；完成单依赖是历史，不扫。
// H116：已排期 入扫描面——排好期的单依赖被废弃同样悬空，漏扫它就是静默死锁的新形态。
function 悬空依赖(root, id) {
  const 出 = [];
  for (const s of ['待审', '待派', '待处理', '待重派', '已排期', '在途', '初检', '核查', '仲裁', '挂起']) {
    for (const x of store.list(root, s)) {
      const d = x.fm.依赖; if (!d) continue;
      const arr = Array.isArray(d) ? d.map(String) : String(d).split(/[，,\s]+/).filter(Boolean);
      if (arr.includes(String(id))) 出.push(x.id);
    }
  }
  return 出;
}

function 废弃(root, id, 因) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (store.TERMINAL.includes(t.state)) return { ok: false, error: '终态单不可废弃' };
  if (!store.isLegal(t.state, '废弃')) return { ok: false, error: `${t.state} 不可直接废弃${t.state === '完成' ? '（做完的活：翻案走推翻，收账走验收）' : ''}` };
  // 依赖悬空扫描（夜班推演 #5）：废弃前查未完成单里还挂着本单依赖的——不阻断，呼叫+留痕，防静默死锁。
  // 扫描面=待办五态+审检链在途四态+挂起（挂起会复活，依赖同样会悬空）；完成单依赖是历史，不扫。
  // H116：已排期 入扫描面——排好期的单依赖被废弃同样悬空，漏扫它就是静默死锁的新形态。
  const 悬空 = 悬空依赖(root, id);
  const r = store.move(root, id, t.state, '废弃', (fm) => { fm.废弃因 = String(因 || '制作人拉闸').replace(/\s+/g, ' ').trim().slice(0, 200); }, nowIso());
  if (r.ok) {
    journal.append(root, `废弃 ${id}（${t.state}→废弃）${悬空.length ? ` · 依赖悬空：${悬空.join('、')} 需改挂` : ''}`);
    if (悬空.length) { try { require('./inbox').post(root, '急', '依赖悬空', `${id} 被废弃，${悬空.join('、')} 的依赖需改挂接棒单`, { 单号: id }); } catch { /* 信箱失败不阻塞 */ } }
  }
  return r;
}

// 待审打回（2026-08-28）：G21 闸表宣告「审过/打回」两颗钮，**打回这颗一直没有实现**。
// 今日 lifecycle.js 补 核查打回 时，我在那段注释里写下「与 G21 那处同型，本次一并按同一取向
// 补上实现」——然后只做了核查那一半。**在注释里宣告一件没发生的事**，正是本仓提案里批的病，
// 我自己犯了一次。这里还上。
//
// 案源（四张实证）：TF-3/TF-6/TF-14/TK-213 卡在待审 30~79 小时。四张全是起草解析器腰斩的
// 残稿（断点都在代码围栏将开处，根因今日已修），TF-14 连「验收标准」整章都没有。
// 这四张既**不能审过**（没有验收标准的单不可审，判官拿什么判过与不过），
// 也**不该废弃**（需求是真的——起草链确实缺那道预检闸）。当时一条出路都没有。
//
// 落点为什么是 废弃 而不是 归档：`待审` 的合法出边只有 废弃 与 待派 两条（store.isLegal 实测），
// 加一条 待审→归档 是改 H108 状态机，属协议动作，不在本次范围。走废弃边、
// 但把「需求还活着」写死在 fm.打回重拆 上，并在流水里明喊「须另行委托重拆」——
// **稿子废掉，需求不废**。调用方（总监）打回后须立即走 /api/pm/draft 委托重拆，
// 让重拆义务几分钟内变成待审里的真单，而不是一个没人看的标记位。
function 待审打回(root, id, 说明) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待审') return { ok: false, error: `只有待审单可打回重拆（当前 ${t.state}）` };
  const 由 = String(说明 || '').trim();
  if (!由) return { ok: false, error: '打回须给说明——不说为什么打回，重拆那一轮只能靠猜' };
  const 悬空 = 悬空依赖(root, id);
  const r = store.move(root, id, '待审', '废弃', (fm) => {
    fm.废弃因 = ('打回重拆：' + 由).replace(/\s+/g, ' ').trim().slice(0, 200);
    fm.打回重拆 = true;   // 与普通废弃的分水岭：这张稿子作废，它承载的需求没作废
  }, nowIso());
  if (!r.ok) return r;
  store.update(root, id, (fm, t2) => ({
    body: (t2.body || '') + `\n\n## 待审打回（人工 · ${nowIso().slice(0, 10)}）\n${由.slice(0, 2000)}\n`,
  }));
  journal.append(root, `待审打回 ${id}（待审→废弃 · 打回重拆 · **需求未废，须另行委托重拆**）：${由.slice(0, 80)}`
    + (悬空.length ? ` · 依赖悬空：${悬空.join('、')} 需改挂` : ''));
  if (悬空.length) {
    try { require('./inbox').post(root, '急', '依赖悬空', `${id} 被打回重拆，${悬空.join('、')} 的依赖需改挂接棒单`, { 单号: id }); } catch { /* 信箱失败不阻塞 */ }
  }
  return r;
}

// 同号返修（H65，2026-08-05 用户拍板：同活同号）：完成→待审〔原 待验收→草稿〕 与
// 待处理→待审〔原 执行失败→草稿〕。单号不动，失败次数/评估回呈轮累计不清零，返修轮+1；
// 改字段/补正文后重新审过放行。新开号只剩三种：验收标准变了（换活）、H59 边界重拆、推翻翻案。
function 返修(root, id, 说明) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (!['完成', '待处理'].includes(t.state)) return { ok: false, error: `只有完成/待处理单可返修（当前 ${t.state}）` };
  // 施工令-032①（H97）：先掐在飞审检、再移单——与 废弃/收回 的「先掐会话后动单」同族。
  // 案源 TK-113：返修与在飞审检相撞，单已回待审，判官会话还在旧态上空转烧额度。
  let 掐 = false;
  try { 掐 = require('./runner').killTicket(root, id, '单被返修（H65 同号改写）'); } catch { /* 执行器未加载不阻断返修 */ }
  const r = store.move(root, id, t.state, '待审', (fm) => {
    delete fm.主办; delete fm.领单时间; delete fm.交付时间; fm.放行 = false;
    delete fm.核查; delete fm.代核; delete fm.初检; delete fm.质检人; delete fm.代核失败次数; delete fm.初检失败次数; // 下一轮重新过检（H67）
    delete fm.待引擎实证; // 施工令-032②：候检印随核查章一同清场——返修后是新一轮，门禁重新判
    fm.返修轮 = (fm.返修轮 || 0) + 1;
  }, nowIso());
  if (r.ok) {
    if (说明) store.update(root, id, (fm, t2) => ({ body: (t2.body || '') + `\n\n## 第 ${(fm.返修轮 || 1) + 1} 轮返修说明（${nowIso().slice(0, 10)}）\n${String(说明).slice(0, 2000)}\n` }));
    journal.append(root, `返修 ${id}（${t.state}→待审 · 第 ${(t.fm.返修轮 || 0) + 1} 轮 · 同号，计数保留${掐 ? ' · 已掐在飞审检会话' : ''}）`);
  }
  return r;
}

// 收回：在途→待派〔原 在途→池〕（清主办/领单时间，退回布告栏，不算复活；收权=撤放行旗）。
function 收回(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '在途') return { ok: false, error: `只有在途单可收回（当前 ${t.state}）` };
  const r = store.move(root, id, '在途', '待派', (fm) => { delete fm.主办; delete fm.领单时间; delete fm.执行池; fm.放行 = false; }, nowIso()); // 收回=收权：撤放行旗（2026-08-05 语义分家：收回待重放行，重投带放行）；运行章一并销（2026-08-26 TK-201 案）
  if (r.ok) journal.append(root, `收回 ${id}（在途→待派 · 清主办 · 撤放行）`);
  return r;
}

// 滞留检查（R3，用户修正：超时不自动撤回，改为诊断 + 告警）。
// 覆盖 在途/初检/核查/仲裁/待处理〔原 在途/质检/待定夺〕：超时的单不移动，只标 滞留告警=true + 记账提醒。
// 完成不入列——驻留位等专项验收是本意，不算滞留（统计口径同理排除完成）。绝不自动改状态。
function 滞留检查(root, cfg, nowMs) {
  const 超时h = (cfg.闸值 || {}).滞留超时小时 ?? 4;
  const now = nowMs || Date.now();
  const 告警 = [];
  for (const state of ['在途', '初检', '核查', '仲裁', '待处理']) {
    for (const t of store.list(root, state)) {
      if (['战役', '专项'].includes(t.fm.父单类型) || ['战役', '专项'].includes(t.fm.主办)) continue; // H53：父单在途=专项进行中的状态章，不适用执行滞留阈值
      if (t.fm.挂起) continue; // 旧制挂起标记残留（迁移前）：制作人按停的单不报滞留噪声
      const 基准 = Date.parse(t.fm.领单时间 || t.fm.更新时间 || '');
      if (Number.isNaN(基准)) continue;
      const 停留h = (now - 基准) / 3600000;
      if (停留h > 超时h) {
        if (!t.fm.滞留告警) { // 只记一次，不刷屏
          store.update(root, t.id, (fm) => { fm.滞留告警 = true; fm.滞留时长h = Math.round(停留h); }, new Date(now).toISOString());
          journal.append(root, `滞留告警 ${t.id}（${state} 停留 ${Math.round(停留h)}h，超 ${超时h}h）——请人工检查，未自动撤回`);
          inbox.post(root, '急', '滞留告警', `${t.id} ${state} 停留 ${Math.round(停留h)}h`, { 单号: t.id });
        }
        告警.push({ id: t.id, state, 停留h: Math.round(停留h) });
      }
    }
  }
  return { 告警 };
}

// 执行失败入位（D31）：→待处理〔原 →执行失败，目录合并〕。纯本地目录改名，零网络依赖——
// 执行器在 CLI 崩溃/超时/非零退出时调用。不清主办（留作诊断线索）；待处理不占在途口径，agent 自动空出。
function 执行失败(root, id, 原因) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '在途' && t.state !== '初检') return { ok: false, error: `当前不可标执行失败（${t.state}）` };
  const r = store.move(root, id, t.state, '待处理', (fm) => {
    fm.失败原因 = String(原因 || '未知').slice(0, 200);
    fm.失败次数 = (Number(fm.失败次数) || 0) + 1;
    fm.失败时间 = nowIso();
  }, nowIso());
  if (r.ok) { journal.append(root, `执行失败 ${id}（${t.state}→待处理 · ${String(原因 || '').slice(0, 60)}）——待分诊`); inbox.post(root, '急', '执行失败', `${id} ${String(原因 || '').slice(0, 80)}`, { 单号: id }); }
  return r;
}

// 失败分诊（D31）：重投→待重派〔原 执行失败→池〕，fm.重投次数=(旧值||0)+1、带放行旗、清执行痕迹。
// 旧「上呈」出路已消亡：待处理本身就是总监分诊位，其余出路走 定夺（接受/给方向/废弃）。
function 失败分诊(root, id, 决定) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待处理') return { ok: false, error: `当前不在待处理（${t.state}）` };
  if (决定 === '重投') {
    const r = store.move(root, id, '待处理', '待重派', (fm) => {
      delete fm.主办; delete fm.领单时间; delete fm.交付时间;
      delete fm.执行池; // 运行章随会话销毁（2026-08-26 TK-201 案：残章钉死冻结池致静默滞留）
      fm.重投次数 = (Number(fm.重投次数) || 0) + 1;
      fm.放行 = true; // 重投=明确指令：带放行旗（2026-08-05 语义分家）
    }, nowIso());
    if (r.ok) journal.append(root, `失败分诊 ${id}：重投（待处理→待重派 · 清主办 · 重投次数+1 · 带放行）`);
    return r;
  }
  return { ok: false, error: `未知决定：${决定}（重投；其余出路走 定夺 接受/给方向/废弃）` };
}

// 上游改动标记（复查#8 = D36）：策划案锚号改版 → 引用它的未完成单全部标待复核。
// 被标记的单：待派不可领、在途不起新执行、交产出被拒——直到核对新版后解除。
function 标记待复核(root, 锚号, 说明) {
  const trace = require('./trace');
  const hits = trace.affectedByRef(root, 锚号);
  const now = nowIso();
  for (const h of hits) store.update(root, h.id, (fm) => { fm.待复核 = { 锚号, 说明: String(说明 || '').slice(0, 120), 标记时间: now }; }, now);
  journal.append(root, `上游改动标记 ${锚号}：${hits.length} 张未完成单标待复核（${hits.map((h) => h.id).join('、') || '无命中'}）`);
  return { ok: true, 命中: hits };
}
function 解除待复核(root, id, 确认说明) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (!t.fm.待复核) return { ok: false, error: '该单没有待复核标记' };
  const 锚 = t.fm.待复核.锚号;
  store.update(root, id, (fm) => { delete fm.待复核; fm.复核确认 = { 锚号: 锚, 时间: nowIso(), 说明: String(确认说明 || '已核对新版') }; }, nowIso());
  journal.append(root, `解除待复核 ${id}（${锚} 已核对新版）`);
  return { ok: true };
}

// ---- 挂起 / 复活（施工令-021 → H108 升格：fm 标记 → 目录态）----
// 旧形态（fm.挂起 印 + 原位冻结 + store.update）已退役为迁移期兼容读（见 交产出/滞留检查 的残留守卫）；
// 新形态：挂起是结束大态里的目录，唯一可逆——复活走 挂起→待重派（人闸：制作人/总监专权）。
// 三把闸的语义分家（别混）：废弃=终态判决；收回=在途退待派活照干；挂起=按停入库，复活后从待重派重新排队。
// 边表口径：只有 待派/待重派/已排期/在途 有→挂起边（审检链中/分诊中的单先走完当口再挂；完成/归档/废弃不可挂）。
function 挂起(root, id, 因, 操作者, 连带自) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state === '挂起') return { ok: false, error: '该单已挂起' };
  if (!store.isLegal(t.state, '挂起')) return { ok: false, error: `${t.state} 不可挂起（边表只允许 待派/待重派/已排期/在途）` };
  const 人 = String(操作者 || '制作人').slice(0, 40);
  const 前态 = t.state;
  const r = store.move(root, id, 前态, '挂起', (fm) => {
    fm.挂起前态 = 前态; // 留档快照：复活一律回待重派，此栏答「当时停在哪」
    fm.挂起因 = String(因 || '').trim().slice(0, 200) || '制作人按停';
    fm.挂起时间 = nowIso(); fm.挂起操作者 = 人;
    if (连带自) fm.连带自 = String(连带自); // 全树挂起时子单记它是被谁连带的，复活树按此认领
  }, nowIso());
  if (r.ok) journal.append(root, `挂起 ${id}（${前态}→挂起 · ${人}${连带自 ? ` · 连带自 ${连带自}` : ''}${String(因 || '').trim() ? ` · ${String(因).trim().slice(0, 60)}` : ''}）——复活走 挂起→待重派（人闸）`);
  return r;
}

// 复活：挂起→待重派（H108 唯一可逆边）。人闸：操作者必须是 制作人/总监。
// 重投/推迟计数不清零（挂起不算重投）；挂起因/前态折进复活记录，不在活单上留失效印。
function 复活(root, id, 操作者) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '挂起') return { ok: false, error: `只有挂起单可复活（当前 ${t.state}）` };
  const 人 = String(操作者 || '').trim();
  if (人 !== '制作人' && 人 !== '总监') return { ok: false, error: '复活是人闸：操作者必须是 制作人/总监' };
  const r = store.move(root, id, '挂起', '待重派', (fm) => {
    fm.复活记录 = { 操作者: 人, 时间: nowIso(), 挂起于: fm.挂起时间 || '', 前态: fm.挂起前态 || '', ...(fm.挂起因 ? { 挂起因: fm.挂起因 } : {}) };
    delete fm.挂起前态; delete fm.挂起因; delete fm.挂起时间; delete fm.挂起操作者; delete fm.连带自;
    delete fm.执行池; // 运行章随会话销毁（2026-08-26 TK-201 案）
    // 重投次数/推迟次数 一字不动：挂起不是重投，账不清零
  }, nowIso());
  if (r.ok) journal.append(root, `复活 ${id}（挂起→待重派 · ${人}）——重新排队，计数不清零`);
  return r;
}

// 子孙盘点（全树挂起/复活共用）：沿 父单 字段广度优先下钻，自带环路防护
// （手工改 frontmatter 造出 A→B→A 的父子环并非不可能，遇上就是死循环）。
function 子孙(root, id) {
  const all = [];
  for (const s of store.STATES) for (const x of store.list(root, s)) all.push(x);
  const out = []; const 见过 = new Set([String(id)]); let 层 = [String(id)];
  while (层.length) {
    const 下 = [];
    for (const x of all) {
      if (!x.fm.父单 || !层.includes(String(x.fm.父单)) || 见过.has(String(x.id))) continue;
      见过.add(String(x.id)); out.push(x); 下.push(String(x.id));
    }
    层 = 下;
  }
  return out;
}

// 全树挂起（施工令-021 第 2 条）：专项/战役父单挂起时，制作人可选连带整棵子树。
// 无挂起边的子单（终态/审检中/完成/已挂起）跳过并如实回报——「跳过」不是失败，制作人要看得见哪些没动、为什么。
function 挂起树(root, id, 因, 操作者) {
  const 头 = 挂起(root, id, 因, 操作者);
  if (!头.ok) return 头;
  const 已挂 = [id]; const 跳过 = [];
  for (const c of 子孙(root, id)) {
    if (c.state === '挂起') { 跳过.push({ id: c.id, 因: '已挂起' }); continue; }
    if (!store.isLegal(c.state, '挂起')) { 跳过.push({ id: c.id, 因: `无挂起边（${c.state}）` }); continue; }
    const r = 挂起(root, c.id, 因, 操作者, id);
    if (r.ok) 已挂.push(c.id); else 跳过.push({ id: c.id, 因: r.error });
  }
  journal.append(root, `全树挂起 ${id}：连带 ${已挂.length - 1} 张子单（${已挂.slice(1).join('、') || '无'}）${跳过.length ? ` · 跳过 ${跳过.map((x) => `${x.id}(${x.因})`).join('、')}` : ''}`);
  return { ok: true, id, 挂起: 已挂, 跳过 };
}

// 全树复活：只放自己和**被本单连带**的子单——制作人单独挂过的子单不被顺手放出
// （那是另一道闸，替他解等于替他改主意）。人闸同 复活。
function 复活树(root, id, 操作者) {
  const 头 = 复活(root, id, 操作者);
  if (!头.ok) return 头;
  const 已解 = [id]; const 跳过 = [];
  for (const c of 子孙(root, id)) {
    if (c.state !== '挂起') continue;
    if (String(c.fm.连带自 || '') !== String(id)) { 跳过.push({ id: c.id, 因: '独立挂起，不代解' }); continue; }
    const r = 复活(root, c.id, 操作者);
    if (r.ok) 已解.push(c.id); else 跳过.push({ id: c.id, 因: r.error });
  }
  journal.append(root, `全树复活 ${id}：连带 ${已解.length - 1} 张子单（${已解.slice(1).join('、') || '无'}）${跳过.length ? ` · 保留挂起 ${跳过.map((x) => x.id).join('、')}` : ''}`);
  return { ok: true, id, 复活: 已解, 跳过 };
}

// ---- 引擎门禁停闸（施工令-032② / H97）——H108 下闸位从「待验收」移到「核查」：
// 核查判通过但命中门禁 → 单停核查原位盖候检印，不转完成；总监确认引擎证据入回执后「实证放行」核查→完成。
// 人闸分家照旧：验收（完成→归档）是制作人人闸，不经此闸；返修/废弃照旧。
const 引擎门禁默认特征 = ['enginectl', 'unity-test', '受控重建'];
function 引擎门禁特征(cfg) {
  const c = ((cfg || {}).执行器 || {}).引擎门禁 || {};
  const ok = Array.isArray(c.特征) && c.特征.length && c.特征.every((x) => typeof x === 'string' && x);
  return ok ? c.特征.slice() : 引擎门禁默认特征.slice(); // 配置非法一律回落内置默认，不让门禁静默失灵
}
// 命中判定：只扫工单「验收标准」章（施工令原文口径）——背景/执行内容里顺口提一句 enginectl
// 不该把整张单拖进门禁。返回命中的那条特征（写进 fm 与流水，可复核），未命中返回 null。
// 词边界（议程第 38 条，2026-08-28）：特征词不许匹配进更长的词里面。
//
// 案源 TF-7：验收标准写着 `isArtifactPath('enginectl-baselines/results-….xml')`——
// 特征 `enginectl` 匹配进了 `enginectl-baselines` 内部。那是**另一个词**（一个测试基线目录名），
// 不是在说这单要跑引擎。
//
// **第一版我修错了方向**：写成「遮掉所有代码区」。那立刻把真阳性也放走了——
// lifecycle 的夹具是 `` `node tools/enginectl.js unity-test` ``，
// 而**行内 code 恰恰是写「要跑什么命令」最自然的形式**。遮代码遮的是症状，
// 真病是匹配没有边界。边界式修法两边都对：`enginectl-baselines` 不中，`enginectl.js` 中。
//
// 右边界只排除 [-_A-Za-z0-9]：`.js` `/` 空格 都算词已结束。
// 左边界同理，免得 `pre-enginectl` 这类也中。
// **不转义**：特征本来就是正则（配置里可写 `dotnet\s+build`），转义会把 \s 变成字面反斜杠，
// 正则语义当场失效——lifecycle.test.js 那格「正则语义生效（不是字面量）」正是守这个的，
// 我加边界时顺手转义，被它当场抓住。只包一层非捕获组再上边界。
function 带边界(p) {
  return new RegExp(`(?<![-_A-Za-z0-9])(?:${String(p)})(?![-_A-Za-z0-9])`, 'gi');
}

// 否定语境（议程第 38 条）：命中处**前面**若出现否定词，那是在说「本单不用引擎」，不是在用。
// 案源 TF-8：验收标准原话「上述条目均为前端沙箱判据与 node 测试链，**不涉 enginectl /
// unity-test / 受控重建**，不触发 H97 引擎门禁停闸」——三条特征全中，而它说的恰恰是不用。
// 窗口取命中点前 24 字：太长会把上一句的否定误算进来，太短接不住「均为…，不涉 X」这种句式。
const 否定词 = /(不涉|不触发|不需要|不需|无需|不用|不走|不含|非引擎|不属于|无关|不做|未涉及|不牵涉)/;
// 转折词：否定之后又转回来的，不算否定（「不涉 A，但要跑 B」里的 B 是真的要跑）
const 转折词 = /(但|然而|不过|仍需|仍要|还需|除外|例外)/;

// 否定语境：**按句读切子句**，不用定长窗口。
// 定长窗口对付不了列表式否定——TF-8 原话「不涉 enginectl / unity-test / 受控重建」，
// 否定词在列表最前，第三项距它 26 字，24 字的窗口刚好够不着，于是前两项豁免、第三项照拦。
// 一个「差两个字就失效」的判据不是判据。改按句读（。！？；换行）取当前子句，
// 列表整体落在同一子句里，三项一并豁免。
function 否定语境(正文, 位置) {
  const 前全 = 正文.slice(0, 位置);
  const 界 = Math.max(前全.lastIndexOf('。'), 前全.lastIndexOf('！'), 前全.lastIndexOf('？'),
    前全.lastIndexOf('；'), 前全.lastIndexOf(';'), 前全.lastIndexOf('\n'));
  const 子句 = 前全.slice(界 + 1);
  if (!否定词.test(子句)) return false;
  // 否定之后若出现转折，否定就被翻回来了——取最后一个否定词之后的片段再看
  const 末否 = 子句.search(否定词);
  const 尾 = 子句.slice(末否);
  return !转折词.test(尾);
}

function 引擎门禁命中(cfg, t) {
  const c = ((cfg || {}).执行器 || {}).引擎门禁 || {};
  if (c.开 === false) return null; // 总开关（缺省开）
  let 章 = null;
  try { 章 = require('./precheck').章节((t && t.body) || '', '验收标准'); } catch { /* 取不到章就退整篇 */ }
  if (章 === null) return null; // 无验收标准章 = 无从判门禁（定稿预检 H62 另有一道拦这个）
  const 正文 = 章;
  for (const p of 引擎门禁特征(cfg)) {
    // 坏正则不能炸掉整条核查收尾路径，但也不能静默放行——回落成字面量包含判定（fail-safe 向严）
    let re = null;
    try { re = 带边界(p); } catch { re = null; }
    if (!re) {
      const i = 正文.toLowerCase().indexOf(String(p).toLowerCase());
      if (i >= 0 && !否定语境(正文, i)) return p;
      continue;
    }
    // 逐个命中点看否定语境：**同一特征可能出现多次**，一处被否定不代表处处被否定。
    // 只要有一处是肯定语境，门禁就该拦——fail-safe 仍然向严。
    let x;
    while ((x = re.exec(正文))) {
      if (!否定语境(正文, x.index)) return p;
    }
  }
  return null;
}
// 候引擎实证：核查判通过但命中门禁 → 单不动窝，核查原位盖候检印（store.update 而非 move）。
function 候引擎实证(root, id, 命中, 判源) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '核查') return { ok: false, error: `只有核查中单可盖候检印（当前 ${t.state}）` };
  const r = store.update(root, id, (fm) => {
    fm.待引擎实证 = { 命中: String(命中 || '').slice(0, 80), 时间: nowIso(), 判源: String(判源 || '核查').slice(0, 20) };
  });
  if (r.ok) {
    journal.append(root, `核查过·候引擎实证 ${id}（门禁特征「${命中}」命中验收标准）——停核查不转完成，待「实证放行」`);
    inbox.post(root, '常', '候引擎实证', `${id} 核查已过但命中引擎门禁「${命中}」，确认实测证据入回执后走「实证放行」`, { 单号: id });
  }
  return r.ok ? { ...r, state: t.state } : r;
}
// 实证放行：总监确认审检证据已入回执 → 核查→完成。只开盖了候检印的单（没盖印的走 核查过 正路）。
function 实证放行(root, id, 操作者, 说明) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '核查') return { ok: false, error: `只有核查中单可实证放行（当前 ${t.state}）` };
  if (!t.fm.待引擎实证) return { ok: false, error: '该单未停引擎门禁闸（无候检印）——正常收口走「核查过」' };
  const 人 = String(操作者 || '总监').slice(0, 40);
  const 印 = t.fm.待引擎实证 || {};
  const r = store.move(root, id, '核查', '完成', (fm) => {
    fm.实证放行 = {
      操作者: 人, 时间: nowIso(), 候检于: 印.时间 || '', ...(印.命中 ? { 命中: 印.命中 } : {}),
      ...(String(说明 || '').trim() ? { 说明: String(说明).trim().slice(0, 200) } : {}),
    };
    delete fm.待引擎实证;
  }, nowIso());
  if (r.ok) journal.append(root, `实证放行 ${id}（核查→完成 · ${人}）——引擎证据已确认入回执，H97 门禁闸开${String(说明 || '').trim() ? ` · ${String(说明).trim().slice(0, 60)}` : ''}`);
  return r;
}

// 建单于待审（返工/推翻的新单落位）。
// 【need_coord】store.create 仍硬编码写 '草稿' 目录（不在新 STATES 里，find 永远找不到）——
// 归总控/持有 core/store.js 的组改为 '待审'；改完本 helper 退役，返工/推翻 改回 store.create。
function 建单于待审(root, id, fm, body) {
  const dst = store.ticketPath(root, '待审', id);
  if (fs.existsSync(dst) || store.find(root, id)) return { ok: false, error: `编号已存在：${id}` };
  fs.mkdirSync(store.stateDir(root, '待审'), { recursive: true });
  fs.writeFileSync(dst, store.serialize(fm, body || ''), 'utf8');
  return { ok: true, id, state: '待审', file: dst };
}

// 返工（D6）：旧单收进终态 + 建新待审单（带返工自回链）。旧单永不复活。
// 终态按语义逐条判（H108）：旧单还在干活/审检（有废弃边）→ 废弃（活没成，被替代）；
// 旧单已到完成（判官过了但被翻案替代）→ 归档（归档原因:返工替代，与原义同）；已在归档/废弃的不再动（不改史）。
// 下游依赖自动接续：引用旧单的未落账单，依赖改指新单——完成单的依赖是历史，不动
// （地图 L0 实战教训：TK-19 返工后 TK-21 卡死，当时靠手工 撤回→改→重投 解救）。
function 返工(root, oldId, newId, fm, body) {
  const old = store.find(root, oldId);
  if (!old) return { ok: false, error: '旧单不存在' };
  if (store.isLegal(old.state, '废弃')) {
    store.move(root, oldId, old.state, '废弃', (f) => { f.废弃因 = '返工替代'; }, nowIso());
  } else if (store.isLegal(old.state, '归档')) {
    store.move(root, oldId, old.state, '归档', (f) => { f.归档原因 = '返工替代'; }, nowIso());
  }
  const nfm = { ...fm, 返工自: oldId, 创建时间: fm.创建时间 || nowIso().slice(0, 10), 更新时间: nowIso() };
  const r = 建单于待审(root, newId, nfm, body);
  if (!r.ok) return r;
  const 接续 = [];
  for (const s of store.STATES) {
    if (store.TERMINAL.includes(s) || s === '完成') continue; // 完成=做完等关账，依赖是历史不改
    for (const t of store.list(root, s)) {
      const deps = t.fm.依赖;
      if (!deps) continue;
      const arr = Array.isArray(deps) ? deps.map(String) : String(deps).split(/[，,\s]+/).filter(Boolean);
      if (!arr.includes(oldId)) continue;
      const next = arr.map((d) => (d === oldId ? newId : d)).join('，');
      store.update(root, t.id, (f) => { f.依赖 = next; });
      接续.push(t.id);
    }
  }
  journal.append(root, `返工 ${oldId} → 新单 ${newId}（旧单收终态 + 开新待审单${接续.length ? ` · 下游依赖接续：${接续.join('/')}` : ''}）`);
  return { ...r, 依赖接续: 接续 };
}

// ---- 推翻重做（制作人专权·审批点）：完成/归档单翻案 = 自动编号返工 ----
// D6 一脉：旧单归档不复活，新待审单带返工链与打回理由，制作人补充要求后再审过放行。
function 推翻(root, id, 理由) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (!['完成', '归档'].includes(t.state)) return { ok: false, error: `推翻只针对完成/归档单（当前 ${t.state}，用定夺/废弃）` };
  if (!String(理由 || '').trim()) return { ok: false, error: '推翻必须写理由（历史要能回答"为什么翻案"）' };
  const m = String(id).match(/^(.+)-(\d+)$/);
  if (!m) return { ok: false, error: '编号不含序号，无法自动派新号' };
  let mx = 0;
  for (const s of store.STATES) for (const x of store.list(root, s)) {
    const mm = String(x.id).match(/^(.+)-(\d+)$/);
    if (mm && mm[1] === m[1]) mx = Math.max(mx, Number(mm[2]));
  }
  const newId = `${m[1]}-${mx + 1}`;
  const fm = {
    id: newId, title: `${t.fm.title}（推翻重做）`, 职能: t.fm.职能, 产出物类型: t.fm.产出物类型,
    优先级: t.fm.优先级 || 'P1', 规模: t.fm.规模 || '单兵', QA: t.fm.QA || '开',
    验收方式: t.fm.验收方式 || '保留', 预计时间: t.fm.预计时间 || '', 预计token: '',
    项目: t.fm.项目, ...(t.fm.阶段 ? { 阶段: t.fm.阶段 } : {}), ...(t.fm.父单 ? { 父单: t.fm.父单 } : {}),
    ...(t.fm.依赖 ? { 依赖: t.fm.依赖 } : {}),
  };
  const body = `## 推翻理由（制作人）\n${String(理由).trim()}\n\n${t.body || ''}`;
  // 完成→归档 是 H108 常规边（专项验收级联口），翻案借道时归档原因写明「推翻替代」——账要能分清落袋与翻案
  if (t.state === '完成') store.move(root, id, '完成', '归档', (f) => { f.归档原因 = '推翻替代（制作人翻案）'; }, nowIso());
  const r = 返工(root, id, newId, fm, body);
  if (r.ok) journal.append(root, `推翻重做 ${id} → ${newId}（制作人翻案：${String(理由).trim().slice(0, 60)}）`);
  return r.ok ? { ...r, 新单: newId } : r;
}

// ---- 隐藏归档（制作人专权）：归档单从一切默认视图湮灭，纸面仍在可考 ----
function 隐藏(root, id, 值) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '归档') return { ok: false, error: `只有归档单可隐藏（当前 ${t.state}）` };
  const on = 值 !== false;
  const r = store.update(root, id, (fm) => { if (on) fm.隐藏 = true; else delete fm.隐藏; });
  if (r.ok) journal.append(root, `隐藏归档 ${id} → ${on ? '隐藏（默认视图不再渲染）' : '取消隐藏'}`);
  return r;
}

module.exports = {
  审过, 待审打回, 放行, 撤回放行, 停靠, 解除停靠, 已停靠, 交产出, QA裁定, 核查过, 核查打回, 送仲裁, 仲裁定, 定夺, 验收,
  撤回, 废弃, 收回, 返修, 滞留检查, 返工, 执行失败, 失败分诊,
  引擎门禁命中, 引擎门禁特征, 引擎门禁默认特征, 候引擎实证, 实证放行, 带边界, 否定语境, // 施工令-032② H97 + 议程38
  标记待复核, 解除待复核, 推翻, 隐藏,
  挂起, 复活, 挂起树, 复活树, 子孙,
  // 过渡别名（H108 改名对照，B/C 组接线完成后删）：旧调用点语义就近映射到新函数
  定稿: 审过, 投池: 放行, 解挂: 复活, 解挂树: 复活树,
};
