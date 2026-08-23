// orchestration/plan.js — Orchestrator 输出协议、DAG 校验与子工单物化。
// AI 只提出计划；确定性内核负责校验角色、依赖、数量和写区后才允许落盘。
//
// 工单库（store）由调用方注入，本模块不自己去找。
// 原先这里写的是 `require('../../../studio/lib/core/store')`——从 apps/platform 上溯
// 三级伸手进 **另一个产品** 的内部模块。按 docs/边界与协作.md，公用件唯一家是仓根
// packages/、双签共建；跨产品引内部实现不在约定内，而且 studio 那边改自己的内部结构
// 时根本不会知道我们在用。改成注入后：
//   · 纯计算的那半（extractJson / configuredPlanFile / resolvePlan / normalizePlan /
//     bodyOf）不再有任何跨产品依赖，可以立刻接线；
//   · 要落盘的那半（materialize / consume）由调用方把 store 递进来，platform 什么时候
//     有了自己的工单库，什么时候就能用，不必等 store 提到 packages/。
const fs = require('fs');
const path = require('path');

const arr = (value) => Array.isArray(value) ? value : value == null || value === '' ? [] : [value];

function extractJson(text) {
  const raw = String(text || '').trim();
  const candidates = [];
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1]);
  const marked = raw.match(/BEGIN_PLAN\s*([\s\S]*?)\s*END_PLAN/i);
  if (marked) candidates.push(marked[1]);
  candidates.push(raw);
  const first = raw.indexOf('{'); const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks || parsed.任务)) return parsed;
    } catch { /* 尝试下一个候选 */ }
  }
  throw new Error('Orchestrator 输出中未找到合法的 JSON 计划（需要 tasks 数组）');
}

function configuredPlanFile(cfg) {
  const value = (cfg.orchestration || {}).planFile || '.studio/plan.json';
  const clean = String(value).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean || path.isAbsolute(clean) || clean.split('/').includes('..')) throw new Error('orchestration.planFile 必须是项目内相对路径');
  return clean;
}

function resolvePlan(cfg, output, workspacePath) {
  const sources = [{ name: 'Provider 最终回复', text: String(output || '') }];
  const relative = configuredPlanFile(cfg);
  const filePath = workspacePath ? path.resolve(workspacePath, relative) : null;
  if (filePath && fs.existsSync(filePath)) {
    sources.push({ name: relative, text: fs.readFileSync(filePath, 'utf8'), filePath });
  }
  const errors = [];
  for (const source of sources) {
    try {
      const parsed = extractJson(source.text);
      return { plan: normalizePlan(cfg, parsed), source: source.name, filePath: source.filePath || null };
    } catch (e) { errors.push(`${source.name}：${e.message}`); }
  }
  throw new Error(`Orchestrator 计划不可用；${errors.join('；')}`);
}

function normalizePlan(cfg, value) {
  const rawTasks = value.tasks || value.任务;
  const maxTasks = Number((cfg.orchestration || {}).maxTasks ?? 20);
  if (!Array.isArray(rawTasks) || !rawTasks.length) throw new Error('计划至少需要一张子工单');
  if (rawTasks.length > maxTasks) throw new Error(`单次计划最多 ${maxTasks} 张子工单`);
  const roles = new Set(Object.keys(cfg.roles || {}).length ? Object.keys(cfg.roles) : (cfg.职能 || []));
  const seen = new Set();
  const tasks = rawTasks.map((raw, index) => {
    const key = String(raw.key || raw.id || raw.键 || `task-${index + 1}`).trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(key)) throw new Error(`子任务 key 非法：${key}`);
    if (seen.has(key)) throw new Error(`子任务 key 重复：${key}`);
    seen.add(key);
    const role = String(raw.role || raw.角色 || '').trim();
    if (!roles.has(role)) throw new Error(`子任务 ${key} 使用未知角色：${role}`);
    if (role === 'orchestrator' && (cfg.orchestration || {}).allowNested !== true) throw new Error(`子任务 ${key} 不允许递归创建 Orchestrator`);
    const title = String(raw.title || raw.标题 || '').trim();
    if (!title || title.length > 100) throw new Error(`子任务 ${key} 标题为空或超过 100 字`);
    const acceptance = arr(raw.acceptance || raw.验收标准).map(String).map((x) => x.trim()).filter(Boolean);
    if (!acceptance.length) throw new Error(`子任务 ${key} 缺少客观验收标准`);
    const task = {
      key, title, role,
      description: String(raw.description || raw.scope || raw.范围 || '').trim(),
      doNot: arr(raw.doNot || raw.不要做).map(String).map((x) => x.trim()).filter(Boolean),
      acceptance,
      dependsOn: arr(raw.dependsOn || raw.depends_on || raw.依赖).map(String).map((x) => x.trim()).filter(Boolean),
      requiredCapabilities: arr(raw.requiredCapabilities || raw.required_capabilities || raw.所需能力).map(String).filter(Boolean),
      writeScope: arr(raw.writeScope || raw.write_scope || raw.写入范围).map(String).filter(Boolean),
      priority: raw.priority || raw.优先级 || '',
      stage: raw.stage || raw.阶段 || '',
      qa: raw.qa !== false && raw.QA !== '关',
      acceptanceMode: raw.acceptanceMode || raw.验收方式 || '委托',
      routing: raw.routing || raw.路由 || null,
    };
    if (role === 'reviewer' && task.writeScope.length) {
      throw new Error(`子任务 ${key} 的 reviewer 是只读角色，不能声明 writeScope；实现评审功能请用 backend，编写集成测试/报告请用 integrator`);
    }
    if (role === 'reviewer' && task.requiredCapabilities.some((cap) => ['coding', 'backend', 'frontend'].includes(cap))) {
      throw new Error(`子任务 ${key} 的 reviewer 不能要求编码能力；请改用 backend、frontend 或 integrator`);
    }
    return task;
  });

  for (const task of tasks) for (const dep of task.dependsOn) {
    if (!seen.has(dep)) throw new Error(`子任务 ${task.key} 依赖未知 key：${dep}`);
    if (dep === task.key) throw new Error(`子任务 ${task.key} 不能依赖自己`);
  }
  const byKey = Object.fromEntries(tasks.map((task) => [task.key, task]));
  const visiting = new Set(); const done = new Set();
  const visit = (key, chain = []) => {
    if (done.has(key)) return;
    if (visiting.has(key)) throw new Error(`任务依赖成环：${[...chain, key].join(' → ')}`);
    visiting.add(key);
    for (const dep of byKey[key].dependsOn) visit(dep, [...chain, key]);
    visiting.delete(key); done.add(key);
  };
  for (const task of tasks) visit(task.key);
  return { summary: String(value.summary || value.摘要 || '').trim(), tasks };
}

function bodyOf(task) {
  const checklist = task.acceptance.map((line) => `- [ ] ${line}`).join('\n');
  const forbidden = task.doNot.length ? task.doNot.map((line) => `- ${line}`).join('\n') : '- 不做工单范围外的改动';
  const writeScope = task.writeScope.length ? task.writeScope.map((line) => `- \`${line}\``).join('\n') : '- 按角色协议和项目现有边界执行';
  return `## 范围\n${task.description || task.title}\n\n## 不要做\n${forbidden}\n\n## 验收标准\n${checklist}\n\n## 写入范围\n${writeScope}\n\n## 完工要求\n按通用角色协议输出回执和实际验证证据。\n`;
}

// store 是必填：它负责一切落盘。缺了就明确报错，不做静默降级——
// 悄悄什么都不写，比直接失败难查得多。
function materialize(root, cfg, parent, plan, store) {
  if (!store || typeof store.find !== 'function' || typeof store.create !== 'function'
    || typeof store.move !== 'function' || typeof store.update !== 'function') {
    throw new Error('materialize 需要注入工单库 store（要求 find/create/move/update 四个方法）；'
      + '本模块不自行解析工单库位置——跨产品直引内部模块不在边界约定内');
  }
  const idByKey = Object.fromEntries(plan.tasks.map((task, index) => [task.key, `${parent.id}-${index + 1}`]));
  // 先完整预检，避免写到一半才发现编号被无关工单占用。
  for (const id of Object.values(idByKey)) {
    const existing = store.find(root, id);
    if (existing && existing.fm.规划来源 !== parent.id) throw new Error(`计划子单编号已被占用：${id}`);
  }

  const created = []; const updated = []; const retained = [];
  for (const task of plan.tasks) {
    const id = idByKey[task.key];
    const fm = {
      id, title: task.title, role: task.role, 职能: task.role,
      // reviewer 的产出是**判定**，不是文件（协-020）。
      //
      // 这里原先写的是 `reviewer ? '文档' : '代码'`——而同一个文件第 93 行刚刚禁止过
      // reviewer 声明 writeScope（「reviewer 是只读角色」），报错里还写着
      // 「编写集成测试/报告请用 integrator」。**一边不许它写文件，一边给它标一份要落盘的产出**，
      // 于是造出的单从派出去那一刻就注定空转：2026-08-23 HW-3 实测 7 分 21 秒、零改动。
      //
      // 「评审意见」是个**不落盘**的类型：它的归宿是回执与 review-opinion 通道，
      // 平台捞走那段判定，不需要 agent 往仓里写任何东西。要产出一份报告/盘点文档的活，
      // 按第 93 行那句话交给 integrator——那个角色本来就能写。
      产出物类型: task.role === 'reviewer' ? '评审意见' : '代码',
      优先级: task.priority || parent.fm.优先级 || 'P1', 规模: '单兵',
      QA: task.qa ? '开' : '关', 验收方式: task.acceptanceMode,
      项目: parent.fm.项目 || '', 阶段: task.stage || 'BUILD',
      父单: parent.id, 规划来源: parent.id, 规划Key: task.key,
      创建时间: new Date().toISOString().slice(0, 10), 更新时间: new Date().toISOString(),
    };
    // 所有子单都依赖父 Orchestrator：父单验收完成后才可领单，并自动合并父单的计划/契约检查点。
    const deps = [parent.id, ...task.dependsOn.map((key) => idByKey[key])];
    if (deps.length) fm.依赖 = deps;
    if (task.requiredCapabilities.length) fm.required_capabilities = task.requiredCapabilities;
    if (task.writeScope.length) fm.write_scope = task.writeScope;
    if (task.routing) fm.routing = task.routing;
    const body = bodyOf(task);
    const existing = store.find(root, id);
    if (!existing) {
      const made = store.create(root, id, fm, body);
      if (!made.ok) throw new Error(made.error);
      const moved = store.move(root, id, '草稿', '待投');
      if (!moved.ok) throw new Error(moved.error);
      created.push(id);
    } else if (['草稿', '待投'].includes(existing.state)) {
      store.update(root, id, (current) => { Object.assign(current, fm); return { body }; });
      if (existing.state === '草稿') store.move(root, id, '草稿', '待投');
      updated.push(id);
    } else retained.push(id); // 已经开工或完成的旧计划子单不被重规划覆盖
  }
  const children = plan.tasks.map((task) => idByKey[task.key]);
  store.update(root, parent.id, (fm) => {
    fm.计划生成 = { 子单: children, 摘要: plan.summary, 时间: new Date().toISOString() };
  });
  return { ok: true, children, created, updated, retained, idByKey };
}

function consume(root, cfg, parent, output, options = {}) {
  const resolved = resolvePlan(cfg, output, options.workspacePath);
  return { ...resolved, ...materialize(root, cfg, parent, resolved.plan, options.store) };
}

module.exports = { extractJson, configuredPlanFile, resolvePlan, normalizePlan, bodyOf, materialize, consume };
