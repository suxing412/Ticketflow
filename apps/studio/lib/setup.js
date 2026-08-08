// setup.js — 首次运行向导的地基（2026-08-08）。
//
// 案源：源码模式下 config.resolveRoot() 找不到 studio.config.json → server 挂 initError
// → Electron 直接 showErrorBox + app.quit()。而**加项目的 UI 就在那个进不去的 app 里**，
// 于是「必须先手写 JSON 才能用」。套件路线靠 部署.bat 铺骨架绕开了，源码路线没人铺。
// 本模块把 部署.bat 干的事搬进 app：建目录 → 落配置 → 铺岗位协议 → 铺风格库骨架。
//
// 纪律：
//   · 已存在的 studio.config.json **绝不覆盖**（升级模式，同 部署.bat 的行为）；
//   · 岗位协议优先从 packages/role-protocol-templates 拷（源码布局，施工令-024 自 套件/ 迁入），
//     拷不到就落内置最小章程——打包后的 exe 里没有 packages/，不能因为拷不到模板就让向导失败；
//   · 只建目录不删东西：向导是新手第一次见到的东西，它不该有任何破坏性动作。

const fs = require('fs');
const path = require('path');
const os = require('os');

// 内置配置模板：与 套件/studio.config.template.json 同源，但**内置一份**，
// 因为打包后的 exe 里没有 套件/。两边有出入时以本文件为准（它是运行时唯一保证存在的那份）。
function 模板配置() {
  return {
    server: { port: 4270 },
    职能: ['策划', '程序', '美术', 'QA', '装配'],
    优先级: ['P0', 'P1', 'P2', 'P3'],
    产出物类型: ['代码', '文档', '资产', '规格'],
    执行池: {
      codex: { 职能: ['程序'], 阈值: 70, 周阈值: 90, 优先: true, 计费: '订阅' },
      claude: { 职能: ['策划', '美术', 'QA', '装配'], 阈值: 50, 周阈值: 90, 计费: '订阅' },
    },
    闸值: { 待验收积压闸: 8, QA自修上限: 2, 滞留超时小时: 4 },
    推荐: { 精力档: '高', 速度窗口小时: 2, 每档处理数: 2 },
    // 代理默认留空（2026-08-08 死代理案）：模板里塞一个具体代理地址，
    // 在没有代理的机器上会被注入给所有子进程，执行会话开局即 ConnectionRefused。
    // 需要代理的用户在参数页填，比让不需要的人去排查一个隐形杀手划算得多。
    网络: { 代理默认: '' },
    执行器: { 间隔秒: 15, 执行超时分钟: 30, 记账间隔分钟: 10, 判官重试上限: 3 },
    并发: { 审检: 1, 零输出分钟: 8 },
    额度: { 沟通保留: 20 },
    quota: { claudeMinIntervalSeconds: 300 },
    模型: {
      codex默认: '', claude默认: 'sonnet', 质检: 'opus', 核查: 'opus', 仲裁: 'opus', 项管: 'opus',
      可选: { codex: [], claude: ['sonnet', 'opus', 'haiku'] },
    },
    项目: { 默认: '', 注册: {} },
    编制: [
      { 职能: '策划', 池序: [{ 池: 'claude', 档: '' }] },
      { 职能: '程序', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: '' }] },
      { 职能: '美术', 池序: [{ 池: 'claude', 档: '' }] },
      { 职能: 'QA', 池序: [{ 池: 'claude', 档: 'opus' }] },
      { 职能: '装配', 池序: [{ 池: 'claude', 档: 'opus' }] },
    ],
  };
}

// 候选安装目录：给新手三个能直接点的，省得自己想放哪
function 候选目录() {
  const home = os.homedir();
  const out = [
    path.join(home, 'Desktop', 'AI工作室'),
    path.join(home, 'AI工作室'),
  ];
  // 便携 exe 自己所在的目录（套件部署的经典形态：exe 与工单库同住）
  if (process.env.PORTABLE_EXECUTABLE_DIR) out.unshift(process.env.PORTABLE_EXECUTABLE_DIR);
  return [...new Set(out.map((p) => p.replace(/\\/g, '/')))];
}

// 内置最小章程（拷不到套件模板时的兜底——向导不许因为缺模板而失败）
const 内置章程 = {
  通用: '# 通用章程\n\n你是本工作室的职能执行 agent。工单由监制台派到你手上，你的全部工作以这张工单为界。\n\n'
    + '## 铁律\n\n1. **一单一事**：只做「范围」内的事，遵守「不要做」。范围外的问题写进回执「异议」。\n'
    + '2. **验收标准是完工定义**：逐条自查，做不到就如实写明。\n'
    + '3. **只碰本职能写区**：跨区需求写异议，不越界动手。\n'
    + '4. **有异议不拒单**：照做 + 记异议，裁决权在制作人。\n'
    + '5. **不碰 git 历史**：不 push / 不 commit / 不改历史。\n'
    + '6. **不留敏感信息**：产出不得含 key、token、密码。\n\n'
    + '## 完工报告格式\n\n```\n# 完工报告 <工单编号>\n## 做了什么\n## 自测结果\n（对照验收标准逐条 ✓/✗ + 证据）\n## 实际消耗\n## 异议\n```\n',
  策划: '# 策划 agent 章程\n\n产出物是**设计文档**。写区=文档区。不改代码、不动资产。\n拿不准的设计不要编，列「待定夺」交制作人。\n',
  程序: '# 程序 agent 章程\n\n产出物是**代码 + 配套测试**。写区=代码区，不碰拼接面（那是装配的独占区）。\n不引入新依赖（需要就写异议）；不做顺手重构。\n',
  美术: '# 美术 agent 章程\n\n产出物是**资产或美术规格文档**。写区=资产区。\n主观项（好不好看）永远留给制作人终审，自查只覆盖客观项（尺寸/命名/格式）。\n',
  QA: '# QA agent 章程\n\n**只读复核**：不改实现。逐条核验验收标准，每条给 ✓/✗ + 证据。\n报告最后一行必须是且只能是「结论：通过」或「结论：不过」。\n',
  装配: '# 装配 agent 章程\n\n把件拼成能跑的组装体。**拼接面是你的独占写区**。\n只拼不造：逻辑有问题写异议让程序修。拼完必须冒烟，新增红灯不许交单。\n',
};

// 找包里的岗位协议模板（源码布局才有；打包后没有，返回 null 走内置）
// 施工令-024：模板已从 套件/岗位协议模板 迁入 packages/role-protocol-templates
function 模板目录() {
  const 候选 = [
    path.resolve(__dirname, '..', '..', '..', 'packages', 'role-protocol-templates'), // apps/studio/lib → 仓库根
    path.resolve(__dirname, '..', 'packages', 'role-protocol-templates'),
  ];
  return 候选.find((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) || null;
}

// 建工作区（幂等）：已存在的配置不覆盖，已存在的章程不覆盖。
// 返回 { ok, root, 新建:bool, 落章程:[...], 提示:[...] }
function 建工作区(目录) {
  const 目标 = String(目录 || '').trim();
  if (!目标) return { ok: false, error: '目录必填' };
  const root = path.resolve(目标);
  const 提示 = [];
  try { fs.mkdirSync(root, { recursive: true }); } catch (e) { return { ok: false, error: '建目录失败：' + e.message }; }
  // 可写性先验：C:\Program Files 这类地方要提前拦，别等 agent 开工才发现写不进去
  try { const t = path.join(root, '.probe-' + Date.now()); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); }
  catch (e) { return { ok: false, error: '目录不可写（换一个位置）：' + e.message.slice(0, 60) }; }

  const cfgPath = path.join(root, 'studio.config.json');
  const 新建 = !fs.existsSync(cfgPath);
  if (新建) fs.writeFileSync(cfgPath, JSON.stringify(模板配置(), null, 2) + '\n', 'utf8');
  else 提示.push('已有 studio.config.json，保留不覆盖（升级模式）');

  require('./core/store').ensureDirs(root);

  const 章程目录 = path.join(root, '岗位协议');
  fs.mkdirSync(章程目录, { recursive: true });
  const src = 模板目录();
  const 落章程 = [];
  for (const 名 of ['通用', '策划', '程序', '美术', 'QA', '装配']) {
    const dst = path.join(章程目录, `${名}.md`);
    if (fs.existsSync(dst)) continue;
    let 内容 = 内置章程[名];
    if (src) { try { 内容 = fs.readFileSync(path.join(src, `${名}.md`), 'utf8'); } catch { /* 用内置 */ } }
    fs.writeFileSync(dst, 内容, 'utf8');
    落章程.push(名);
  }

  const 风格库 = path.join(root, '风格库');
  fs.mkdirSync(path.join(风格库, '美术库'), { recursive: true });
  const ax = path.join(风格库, '策划标杆.md');
  if (!fs.existsSync(ax)) fs.writeFileSync(ax, '# 策划标杆（提炼式设计公理）\n\n', 'utf8');

  // 凭据文件不进版本库（托管 key 是 DPAPI 密文，但也没有进 git 的道理）
  const gi = path.join(root, '.gitignore');
  const 行 = ['node_modules/', '*.log', '.studio-state.json', '.studio-state.lock', '凭据.json'];
  try {
    const 旧 = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    const 缺 = 行.filter((l) => !旧.split(/\r?\n/).includes(l));
    if (缺.length) fs.writeFileSync(gi, (旧 && !旧.endsWith('\n') ? 旧 + '\n' : 旧) + 缺.join('\n') + '\n', 'utf8');
  } catch { 提示.push('.gitignore 写入失败（不影响使用）'); }

  return { ok: true, root: root.replace(/\\/g, '/'), 新建, 落章程, 提示 };
}

module.exports = { 模板配置, 候选目录, 建工作区, 模板目录, 内置章程 };
