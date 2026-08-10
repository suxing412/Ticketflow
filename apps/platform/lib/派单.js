// 派单 —— 把「该派给谁」和「工单流转」接起来（协-002）。
//
// 纯计算 + 工单库文件操作，**不起任何进程**：派单只决定「谁来干」，不负责干。
// 真正拉起 CLI 的是 scripts/执行器.js，那是独立进程。
// 所以本模块可以住 server 进程，桩模式断言不受影响。
'use strict';

const 路由器 = require('./routing/router');
const 加固 = require('./执行加固');

// 权限判定（协-002 拍板 A3）
// 白名单之外一律受限——**缺配置即最严，不是最松**。
// 判据只看角色不看项目：项目维度等真有需求再加，现在加是凭空造复杂度。
function 权限参数(配置, 角色) {
  const 权 = (配置.执行 && 配置.执行.权限) || {};
  const 放开 = Array.isArray(权.放开) ? 权.放开 : [];
  const 受限参数 = Array.isArray(权.受限参数) ? 权.受限参数 : ['--permission-mode', 'plan'];
  if (放开.includes(String(角色 || ''))) {
    return { 模式: '放开', 参数: null, 说明: `角色 ${角色} 在放开白名单内，沿用适配器默认（含权限绕过）` };
  }
  return {
    模式: '受限',
    参数: 受限参数,
    说明: `角色 ${角色 || '(空)'} 不在放开白名单内 → 受限模式，覆盖掉适配器默认的权限绕过开关`,
  };
}

// 预算冻结：哪些池现在不许派。budget 缺位不阻断派单，但要**明说**。
function 冻结情况(公用件, 配置, 账本根) {
  try {
    const budget = 公用件.载入('budget', 'budget.js');
    const 冻 = budget.并入({}, budget.冻结池(配置, 账本根));
    const 挡 = {};
    for (const [池, 信息] of Object.entries(冻)) {
      if (信息 && 信息.locked) 挡[池] = 信息.reason || '预算闸冻结';
    }
    return { ok: true, 挡, 原始: 冻 };
  } catch (e) {
    return { ok: false, 挡: {}, 错误: `预算闸不可用：${e.message}` };
  }
}

// 选人：排名 → 过冻结 → 候选链降级（留痕）
// 工单要递进去：router 的 crossProviderReview 靠 task.fm.执行池 知道「原执行方是谁」，
// 才能在评审时优先挑**别家**（同源盲区是真的——同一个模型往往看不出自己的错）。
// 不递的话它拿不到 original，跨厂避让整个失效，而且**不会报错**，只会安静地挑回同一家。
function 选派(仓根, 配置, { 角色, 类别 = '执行', 公用件, 账本根, 工单 = null }) {
  const 排名 = 路由器.rankProviders(仓根, 配置, {
    role: 角色, kind: 类别,
    task: 工单 ? { fm: 工单.fm || {} } : null,
  });
  if (!排名.length) return { ok: false, error: '无候选 Provider：检查是否启用、能力是否匹配' };

  const 冻 = 冻结情况(公用件, 配置, 账本根 || 仓根);
  const 择 = 加固.择候选(排名, 冻.挡);
  if (!择.选中) {
    return {
      ok: false,
      error: '全部候选都不可用',
      跳过: 择.跳过,
      ...(冻.ok ? {} : { 预算闸: 冻.错误 }),
    };
  }
  const 权 = 权限参数(配置, 角色);
  return {
    ok: true,
    选中: 择.选中.name,
    分数: 择.选中.score,
    理由: 择.选中.reasons,
    降级: 择.降级,
    跳过: 择.跳过,          // 降级必须留痕：不留的话账单与战绩对不上号
    权限: 权,
    ...(冻.ok ? {} : { 预算闸: 冻.错误 }),
  };
}

// 工单流转：待投 → 在途，并把派单结果写进 fm。
// 只在**确实要执行**时调用；干跑不流转工单（干跑是演练，不该改变工单状态）。
// 依赖就绪判定（协-004）。
//
// plan.materialize 生成的子单带 fm.依赖，但此前没人检查过——于是子单可以在依赖还没干完时
// 就被派出去，拿到一个缺半截的工作区。DAG 写在工单里却不被执行，等于没有 DAG。
//
// 判据：依赖单必须已「完成」。未完成就拒派，并逐个说清卡在谁身上——
// 只说「依赖未就绪」等于让人自己去翻，那是把排查成本转嫁给使用者。
function 依赖就绪(工单库, 根, 工单) {
  const 依赖 = 工单.fm && 工单.fm.依赖;
  const 表 = Array.isArray(依赖) ? 依赖 : (依赖 ? [依赖] : []);
  if (!表.length) return { ok: true, 依赖单: [] };
  const 未完成 = []; const 缺失 = []; const 依赖单 = [];
  for (const id of 表) {
    const t = 工单库.find(根, String(id));
    if (!t) { 缺失.push(String(id)); continue; }
    if (t.state !== '完成') { 未完成.push({ id: t.id, 当前状态: t.state }); continue; }
    依赖单.push(t);
  }
  if (缺失.length || 未完成.length) {
    return {
      ok: false, 依赖单,
      error: '依赖未就绪，拒绝派活'
        + (未完成.length ? `；未完成：${未完成.map((x) => `${x.id}(${x.当前状态})`).join('、')}` : '')
        + (缺失.length ? `；找不到：${缺失.join('、')}` : ''),
      未完成, 缺失,
    };
  }
  return { ok: true, 依赖单 };
}

function 落单(工单库, 根, id, 派单结果) {
  const t = 工单库.find(根, id);
  if (!t) return { ok: false, error: `工单不存在：${id}` };
  if (t.state !== '待投') {
    return { ok: false, error: `只有「待投」的工单可以派发，当前是「${t.state}」` };
  }
  const r = 工单库.move(根, id, '待投', '在途', (fm) => {
    fm.执行池 = 派单结果.选中;
    fm.派单时间 = new Date().toISOString();
    fm.权限模式 = 派单结果.权限.模式;
    if (派单结果.降级) fm.降级留痕 = 派单结果.跳过;
    // worktree.integrate 靠 fm.workspace.commit 找依赖单的检查点，prepare 靠
    // fm.workspace.path 复用已存在的工作树。这两处是 worktree.js 的既有契约——
    // 只写 fm.检查点 它们看不见，依赖集成会**静默跳过所有依赖**（skipped 而非报错）。
    if (派单结果.工作区) {
      fm.workspace = {
        path: 派单结果.工作区.path,
        branch: 派单结果.工作区.branch,
        mode: 派单结果.工作区.mode,
      };
    }
  });
  return r.ok ? { ok: true, id, 状态: '在途', 执行池: 派单结果.选中 } : r;
}

module.exports = { 权限参数, 冻结情况, 选派, 落单, 依赖就绪 };
