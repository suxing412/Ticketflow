// budget-resolve.js — 预算闸壳的**解析器**（施工令-046）。本体在 packages/budget（协-003）。
//
// 为什么单独一文件：`lib/budget.js` 必须 `module.exports = <预算闸模块本身>`（所有消费方
// 直接调 并入/冻结池），没有地方挂可测的入口。把三候选逻辑放这里，测试就能注入候选参数
// 逐条验证，而不必往真包的导出对象上挂测试钩子（那会污染 packages/budget 的形状）。
//
// 打包态坑（0.26.5 冒烟案）：asar 内 ../../../packages 逃不出应用包，故有三候选：
//   ①仓内相对（开发态）→②TICKETFLOW_PACKAGES 环境变量→③studio.config.json · packages路径
// 候选③此前是硬编码的某台机器仓根绝对路径——换机即死（robinwang2 2026-08-11 来信）。
// （壳里不许再出现盘符绝对路径，测试拿正则守着这条，连注释里的示例也不留。）
// 现在读配置：缺省/空串=跳过该候选，相对值按监制台仓根解析。
//
// 全失守不再静默：落空实现的同时 journal 留证 + 在返回对象上打 失效/失败因，
// server 据此在 /api/gates 挂失效位、参数页出红标。保险丝烧了要响。
const fs = require('fs');
const path = require('path');

// 候选③的配置读取。不走 core/config.load()——那条路会顺带跑编制迁移并**写盘**，
// 而这里只是取一个字符串，在 require 期做写盘副作用不划算。BOM 容忍与 load() 同款。
function 读配置包路径(root) {
  const raw = fs.readFileSync(path.join(root, 'studio.config.json'), 'utf8');
  const cfg = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
  return typeof cfg.packages路径 === 'string' ? cfg.packages路径.trim() : '';
}

// 空实现：记账缺席但绝不炸 gates/派发——保险丝失效好过全线停摆。
// 但「不炸」不等于「不吭声」：控制台一行 + journal 一条 + 对象上的失效位（UI 与 API 读它）。
function 空实现(失败因, 根) {
  const 说 = 失败因.map((f) => `${f.候选}：${f.因}`).join('；');
  console.error('[budget] 预算闸失效——三候选全失守，落空实现：不落账、不冻结（' + 说 + '）');
  // 控制台那行开机就滚没了，流水是唯一留得住的证据面；找不到仓根就只剩控制台，如实记下这一点。
  let journal = '未落（找不到监制台仓库，无处可落）';
  if (根) {
    try {
      require('./journal').append(根, `预算闸失效：三候选全失守，落空实现——不落账、不冻结｜${说}`);
      journal = '已落';
    } catch (e) { journal = '未落（' + e.message + '）'; }
  }
  return {
    usageOf: () => ({ 输入: 0, 缓存: 0, 输出: 0 }),
    记: () => null,
    冻结池: () => ({}),
    并入: (g) => g,
    失效: true, 失败因, journal,
  };
}

// 解析。参数全部可注入（测试用）：
//   相对=候选①的路径（不给则走字面量 require，保持打包器的静态可分析性）
//   环境=候选②的 TICKETFLOW_PACKAGES 值　根=候选③找 studio.config.json 的仓根
function 解析(o = {}) {
  const 环境 = o.环境 !== undefined ? o.环境 : process.env.TICKETFLOW_PACKAGES;
  const 根 = o.根 !== undefined ? o.根 : require('./core/config').resolveRoot();
  const 候选 = [
    {
      名: '仓内相对',
      取: () => (o.相对 ? require(o.相对) : require('../../../packages/budget/budget.js')),
    },
    {
      名: 'TICKETFLOW_PACKAGES 环境变量',
      取: () => {
        if (!环境) throw new Error('未设');
        return require(path.join(环境, 'budget/budget.js'));
      },
    },
    {
      名: 'studio.config.json · packages路径',
      取: () => {
        if (!根) throw new Error('找不到监制台仓库（缺 studio.config.json）');
        const p = 读配置包路径(根);
        if (!p) throw new Error('配置里 packages路径 为空——跳过该候选');
        return require(path.join(path.resolve(根, p), 'budget/budget.js'));
      },
    },
  ];
  const 失败因 = [];
  for (const c of 候选) {
    try {
      const m = c.取();
      // 形状校验：解析到了但不是预算闸（半截包/同名文件）比找不到更坑——当场判失败进下一候选
      if (!m || typeof m.冻结池 !== 'function' || typeof m.并入 !== 'function') throw new Error('模块形状不对（缺 冻结池/并入）');
      return m;
    } catch (e) {
      // 只留首行：MODULE_NOT_FOUND 的 message 后面挂着整段 Require stack，
      // 原样带进 journal 与 UI 悬停就是三屏噪音，首行「Cannot find module 'X'」才是那条线索。
      失败因.push({ 候选: c.名, 因: String(e && e.message || e).split('\n')[0] });
    }
  }
  return 空实现(失败因, 根);
}

// /api/gates 的失效位（server 直接展开）。正常命中时是空对象——返回体逐字节不变。
function 失效位(b) {
  return b && b.失效 ? { budget失效: true, budget失败因: b.失败因 || [] } : {};
}

module.exports = { 解析, 失效位, 读配置包路径 };
