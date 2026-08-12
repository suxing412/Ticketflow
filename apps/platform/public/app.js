'use strict';
const $ = (id) => document.getElementById(id);
const 秒 = (n) => (n == null ? '—' : Math.round(n / 1000) + 's');
const 转义 = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const 取JSON = (u, o) => fetch(u, o).then((r) => r.json().then((j) => ({ 码: r.status, 体: j })));

// ── 健康 ──
async function 刷健康() {
  try {
    const { 体: j } = await 取JSON('/api/health');
    $('标题').textContent = j.平台 + ' v' + j.版本;
    $('模式徽').textContent = j.桩模式 ? '本体桩模式 · server 不起进程' : '未知';
    $('健康行').textContent = '服务在线 · 端口 ' + j.端口 + ' · 公用件 ' + j.公用件 + ' · ' + j.时刻;
  } catch { $('健康行').innerHTML = '<span class="级急">服务不可达</span>'; }
}

// 第一次打开的那一步：把人填的目录落成配置。
// 服务端配完当场生效（server.js 里 工单根 是 let），所以这里刷一下就能看到空看板。
async function 落位工单库() {
  const 值 = ($('工单根输入').value || '').trim();
  const 回 = $('落位回执');
  回.textContent = '正在建目录…';
  try {
    const { 码, 体: j } = await 取JSON('/api/setup/tickets', { method: 'POST', body: JSON.stringify({ 根目录: 值 }) });
    if (码 !== 200 || !j.ok) { 回.innerHTML = '<span class="级急">没配上</span> ' + 转义(j.error || ('HTTP ' + 码)); return; }
    // 警告要显示得比成功更醒目：配了却不生效（被环境变量盖住）是最难自查的一种情况，
    // 它长得跟成功一模一样，人会以为配好了然后对着空看板发懵。
    回.innerHTML = j.警告
      ? '<span class="级急">配是写进去了，但不会生效</span> ' + 转义(j.警告)
      : '已落位：' + 转义(j.根目录) + (j.换根 ? '（原来是 ' + 转义(j.旧根 || '') + '）' : '');
    if (!j.警告) setTimeout(() => { 刷工单(); 刷自检(); }, 300);
  } catch (e) { 回.innerHTML = '<span class="级急">没配上</span> ' + 转义(e.message); }
}

// ── 工单看板 ──
async function 刷工单() {
  const 滤 = $('滤状态').value;
  try {
    const { 码, 体: j } = await 取JSON('/api/tickets' + (滤 ? '?state=' + encodeURIComponent(滤) : ''));
    if (码 === 503) {
      // 未配工单库根是**最常见的首次使用障碍**——第一次打开必撞。
      // 光把修法印出来还是个死胡同：人得去开编辑器、手搓一份 JSON、再重启服务。
      // 这里直接给一个输入框当场配掉。产品仍然不猜路径，只是不再让人翻文档。
      $('工单体').innerHTML =
        '<tr><td colspan="7">'
        + '<div><span class="级急">工单库还没配</span> —— 工单是业务数据，得放你自己的私仓，本产品不替你选位置。</div>'
        + '<div class="设置行"><input id="工单根输入" placeholder="D:\\你的私仓\\工单" spellcheck="false">'
        + '<button id="工单根落位">就用这个目录</button></div>'
        + '<div class="提示" id="落位回执">填绝对路径。目录不存在会替你建好（草稿/待投/在途/质检/完成 五个子目录）。</div>'
        + '<details class="提示"><summary>或者用配置文件/环境变量</summary><pre>' + 转义(j.error) + '</pre></details>'
        + '</td></tr>';
      $('工单根落位').onclick = 落位工单库;
      $('工单根输入').onkeydown = (e) => { if (e.key === 'Enter') 落位工单库(); };
      $('工单来源').textContent = '';
      return;
    }
    $('工单来源').textContent = j.根目录 || '';
    if (!j.工单 || !j.工单.length) { $('工单体').innerHTML = '<tr><td colspan="7" class="淡">还没有工单</td></tr>'; return; }
    const 序 = { 草稿: 0, 待投: 1, 在途: 2, 质检: 3, 完成: 4 };
    // 先按状态，再让子单紧跟父单——DAG 平铺在列表里就看不出结构了。
    const 键 = (t) => ((t.fm && t.fm.父单) ? t.fm.父单 + '' + t.id : t.id);
    j.工单.sort((a, b) => (序[a.state] - 序[b.state]) || 键(a).localeCompare(键(b)));
    $('工单体').innerHTML = j.工单.map((t) => {
      const f = t.fm || {};
      const 可派 = t.state === '待投';
      const 可判 = t.state === '质检';
      const 可投 = t.state === '草稿';
      // 在途单原先一个操作都没有。于是巡检报「已在途 682 分钟，执行器可能已挂」之后，
      // 人在界面上无事可做——只能去磁盘上手挪文件。**报了问题却不给解法**，
      // 比不报还难受：你知道它坏了，还得自己想办法。
      // 状态机本来就允许 在途 → 待投（退回重投），把它接出来即可。
      const 可退 = t.state === '在途';
      const 层 = f.父单 ? '<span class="淡">└ </span>' : '';   // 子单缩进，DAG 一眼可辨
      return '<tr><td>' + 层 + '<a href="#" onclick="看单(\'' + 转义(t.id) + '\');return false"><code>' + 转义(t.id) + '</code></a></td>'
        + '<td><span class="态 ' + 转义(t.state) + '">' + 转义(t.state) + '</span></td>'
        + '<td><span class="角色 ' + 转义(f.role || f.职能 || '') + '">' + 转义(f.role || f.职能 || '') + '</span></td>'
        + '<td>' + 转义(f.title || '') + '</td>'
        + '<td>' + 转义(f.项目 || '') + '</td>'
        + '<td><span class="池 ' + 转义(f.执行池 || '') + '">' + 转义(f.执行池 || '') + '</span></td>'
        + '<td>'
        + (可投 ? '<button class="btn" onclick="迁移(\'' + 转义(t.id) + '\',\'待投\')">投出</button> ' : '')
        + (可派 ? '<button class="btn" onclick="跑(\'' + 转义(t.id) + '\',true)">干跑</button> '
                + '<button class="btn danger-o" onclick="跑(\'' + 转义(t.id) + '\',false)">真跑（花钱）</button>' : '')
        + (可退 ? '<button class="btn" onclick="退回待投(\'' + 转义(t.id) + '\')">退回待投</button>' : '')
        + (可判 ? '<button class="btn" onclick="判(\'' + 转义(t.id) + '\',true)">试判</button> '
                + '<button class="btn danger-o" onclick="判(\'' + 转义(t.id) + '\',false)">真判（花钱）</button>' : '')
        + '</td></tr>';
    }).join('');
  } catch (e) { $('工单体').innerHTML = '<tr><td colspan="7" class="级急">工单接口不可达</td></tr>'; }
}

// 单张详情。看板一行只有摘要——正文、质检意见、依赖链、流转痕迹都在 fm 里，
// 不给个地方看，出问题时只能去翻磁盘上的 .md。
async function 看单(id) {
  $('运行区').style.display = '';
  $('运行').textContent = '读取中…';
  try {
    const { 码, 体: j } = await 取JSON('/api/tickets/' + encodeURIComponent(id));
    if (码 !== 200) { $('运行').textContent = j.error || '读取失败'; return; }
    const fm = j.fm || {};
    const 行 = [];
    行.push('# ' + id + '　[' + j.状态 + ']　' + (fm.title || ''));
    if (fm.项目) 行.push('项目：' + fm.项目);
    if (fm.执行池) 行.push('执行池：' + fm.执行池 + '　权限：' + (fm.权限模式 || '—'));
    if (fm.依赖) 行.push('依赖：' + [].concat(fm.依赖).join('、'));
    if (fm.父单) 行.push('父单：' + fm.父单);
    if (fm.检查点) 行.push('检查点：' + fm.检查点);
    if (fm.发布提交) 行.push('发布提交：' + fm.发布提交);
    if (fm.降级留痕) 行.push('降级留痕：' + JSON.stringify(fm.降级留痕));
    if (fm.免检原因) 行.push('免检：' + fm.免检原因);
    if (fm.质检结论) {
      行.push('');
      行.push('## 质检：' + fm.质检结论 + '（判官 ' + (fm.质检判官 || '?') + '，' + (fm.质检时间 || '') + '）');
      const 意 = fm.质检意见 || {};
      if ((意.问题 || []).length) 行.push('阻断问题：\n' + 意.问题.map((x) => '  - ' + x).join('\n'));
      if ((意.证据 || []).length) 行.push('验收证据：\n' + 意.证据.map((x) => '  - ' + x).join('\n'));
    }
    行.push('');
    行.push('## 正文');
    行.push(j.正文 || '（空）');
    $('运行').textContent = 行.join('\n');
  } catch (e) { $('运行').textContent = '读取失败：' + e.message; }
}

// 把卡在途的单退回待投重跑。
// 多问一句，因为这个动作有个隐蔽的坏情况：如果那个 CLI 其实**还活着**，
// 退回之后再派一次，同一张单会有两个 agent 同时在改同一片代码。
// 巡检说「可能已挂」是推断不是事实——它只能看见「很久没动静」。
async function 退回待投(id) {
  if (!confirm('把 ' + id + ' 退回待投，之后可以重新派活。\n\n'
    + '先确认那次执行**真的已经停了**：巡检只能看见「很久没动静」，推断不出进程死没死。\n'
    + '若它还活着，重派会让两个 agent 同时改同一片代码。\n\n确定退回？')) return;
  const { 体: j } = await 取JSON('/api/tickets/' + encodeURIComponent(id) + '/move', {
    method: 'POST', body: JSON.stringify({ 到: '待投' }),
  });
  if (!j.ok) { alert('退回失败：' + j.error); return; }
  刷工单(); 刷调度();
}

async function 迁移(id, 到) {
  const { 体: j } = await 取JSON('/api/tickets/' + encodeURIComponent(id) + '/move', {
    method: 'POST', body: JSON.stringify({ 到 }),
  });
  if (!j.ok) alert('流转失败：' + j.error);
  刷工单();
}

async function 跑(id, 干跑) {
  // 真跑要花钱，且可能改目标仓——多问一句。前端确认不是安全边界（服务端三闸才是），
  // 但它挡得住手滑，而手滑是这里最可能发生的事。
  if (!干跑 && !confirm('真跑会调用 AI CLI、产生费用，若工单带「项目」还会在目标仓提交并合并。\n\n工单：' + id + '\n\n确定继续？')) return;
  $('运行区').style.display = '';
  $('运行').textContent = (干跑 ? '干跑' : '真跑') + '中…（真跑可能要几十秒）';
  try {
    const { 体: j } = await 取JSON('/api/exec/run/' + encodeURIComponent(id), {
      method: 'POST', body: JSON.stringify({ 干跑 }),
    });
    $('运行').textContent = JSON.stringify(j, null, 2);
    // orchestrator 跑出合规计划时给一个物化入口。<b>不自动物化</b>——
    // AI 提的拆解没经人眼就落成一批工单，等于把「AI 只提计划、确定性内核负责校验」
    // 这条原则从中间掐断。物化是一个独立的、人点下去的动作。
    const 头 = $('运行区').querySelector('h2');
    const 旧 = 头.querySelector('.物化钮'); if (旧) 旧.remove();
    if (j.计划预览 && j.计划预览.合规) {
      const b = document.createElement('button');
      b.className = 'btn accent 物化钮';
      b.textContent = '物化这 ' + j.计划预览.任务数 + ' 张子单';
      b.onclick = () => 物化(id);
      头.appendChild(b);
    }
  } catch (e) { $('运行').textContent = '调用失败：' + e.message; }
  刷工单(); 刷战绩(); 刷排名(); 刷调度(); 刷消耗();
}

// 物化：把 orchestrator 的计划落成真实子单。
// 需要把<b>原始输出</b>回填给 /api/plan/materialize——它自己再解析一次，
// 而不是信任前端传来的已解析结构：前端能改的东西，不该成为落盘的依据。
async function 物化(父单) {
  const 文 = $('运行').textContent;
  let 原始 = '';
  try { 原始 = (JSON.parse(文).计划预览 || {}).正文预览 || ''; } catch { /* 下面兜底 */ }
  if (!原始) {
    alert('拿不到原始计划文本。请改用接口物化：\nPOST /api/plan/materialize {"输出": <orchestrator 的原始回复>, "父单": "' + 父单 + '"}');
    return;
  }
  const { 体: j } = await 取JSON('/api/plan/materialize', {
    method: 'POST', body: JSON.stringify({ 输出: 原始, 父单 }),
  });
  $('运行').textContent = JSON.stringify(j, null, 2);
  刷工单(); 刷调度();
}

async function 判(id, 干跑) {
  if (!干跑 && !confirm('真判会调用另一个 AI CLI 做质检、产生费用。\n\n工单：' + id + '\n\n确定继续？')) return;
  $('运行区').style.display = '';
  $('运行').textContent = (干跑 ? '试判' : '真判') + '中…';
  try {
    const { 体: j } = await 取JSON('/api/exec/qa/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ 干跑 }) });
    $('运行').textContent = JSON.stringify(j, null, 2);
  } catch (e) { $('运行').textContent = '调用失败：' + e.message; }
  刷工单(); 刷战绩(); 刷调度();
}

// 批量操作。<b>只做干跑与流转，绝不批量真跑</b>——
// 一个按钮同时花掉几张单的钱，不该存在。真跑必须逐张点，每张独立过三闸。
async function 批量投出() {
  const { 体: j } = await 取JSON('/api/tickets?state=' + encodeURIComponent('草稿'));
  const 单 = (j.工单 || []).map((t) => t.id);
  if (!单.length) { alert('没有草稿单'); return; }
  if (!confirm('把这 ' + 单.length + ' 张草稿投出到「待投」？\n\n' + 单.join('、'))) return;
  const 结果 = [];
  for (const id of 单) {
    const { 体: r } = await 取JSON('/api/tickets/' + encodeURIComponent(id) + '/move', {
      method: 'POST', body: JSON.stringify({ 到: '待投' }),
    });
    结果.push(id + (r.ok ? ' ✓' : ' ✗ ' + r.error));
  }
  $('运行区').style.display = '';
  $('运行').textContent = '批量投出：\n' + 结果.join('\n');
  刷工单(); 刷调度();
}

// 按调度算出来的「本轮可派」逐张干跑。干跑零计费，用来在真跑前把一批单的
// 选人、权限、依赖一次看完——比一张张点省事，又不会花钱。
async function 按调度干跑() {
  const { 码, 体: t } = await 取JSON('/api/exec/tick');
  if (码 !== 200) { alert("执行器没在 4372 应答。npm start 会带起它——单独起过 server 才会缺；也可能是它刚崩了，看终端。"); return; }
  const 可派 = t.本轮可派 || [];
  if (!可派.length) {
    $('运行区').style.display = '';
    $('运行').textContent = '本轮无可派工单。\n\n跳过原因：\n'
      + (t.跳过 || []).map((s) => '  ' + s.id + '：' + s.原因).join('\n');
    return;
  }
  $('运行区').style.display = '';
  $('运行').textContent = '干跑 ' + 可派.length + ' 张…';
  const 行 = [];
  for (const x of 可派) {
    const { 体: r } = await 取JSON('/api/exec/run/' + encodeURIComponent(x.id), {
      method: 'POST', body: JSON.stringify({ 干跑: true }),
    });
    行.push(x.id + '  → ' + (r.ok ? (r.provider + '（' + (r.权限 && r.权限.模式) + '）') : ('✗ ' + r.error)));
  }
  $('运行').textContent = '批量干跑（零计费）：\n' + 行.join('\n')
    + '\n\n真跑请逐张点——每张独立过三闸，批量真跑不提供。';
  刷工单(); 刷战绩(); 刷调度();
}

// 选角色自动填骨架。**只在正文还是原样时替换**——人改过的内容绝不覆盖，
// 那是最容易招人恨的交互：辛苦写了半页，切个下拉全没了。
let 上次模板 = '';
async function 换模板() {
  const 现 = $('新正文').value;
  if (现 && 现 !== 上次模板) return;   // 人动过了，不碰
  const { 体: j } = await 取JSON('/api/tickets/template?role=' + encodeURIComponent($('新角色').value));
  if (j.ok) { $('新正文').value = j.正文; 上次模板 = j.正文; }
}

function 开建单() {
  $('建单区').style.display = '';
  换模板();
  $('新编号').focus();
}

async function 建单() {
  const id = $('新编号').value.trim();
  if (!id) { $('建单反馈').textContent = '要有编号'; return; }
  const fm = { id, role: $('新角色').value, title: $('新标题').value.trim() };
  const 项目 = $('新项目').value.trim();
  if (项目) fm.项目 = 项目;
  const { 体: j } = await 取JSON('/api/tickets', {
    method: 'POST', body: JSON.stringify({ id, fm, 正文: $('新正文').value }),
  });
  if (j.ok) {
    const 病 = (j.验收标准 && j.验收标准.体检) || [];
    $('建单反馈').innerHTML = '已落草稿（验收标准 ' + ((j.验收标准 && j.验收标准.条数) || 0) + ' 条）'
      + (病.length ? '<br><span class="级常">体检提醒：</span>' + 病.map((b) => 转义(b.说)).join('；') : '');
  } else $('建单反馈').textContent = '失败：' + j.error;
  if (j.ok) { $('新编号').value = ''; $('新标题').value = ''; $('新正文').value = ''; 刷工单(); }
}

// ── 产线状态 ──
// 这一块回答的是「为什么产线没在动」。没有它的话，一个空的工单看板有两种可能——
// 没活干，或者有活但全被闸住了——而这两种的处置完全相反。
async function 刷调度() {
  try {
    const { 码, 体: j } = await 取JSON('/api/exec/tick');
    if (码 !== 200) {
      $('调度概览').innerHTML = '<span class="淡">' + 转义(j.error || "执行器没在 4372 应答。npm start 会带起它——单独起过 server 才会缺；也可能是它刚崩了，看终端。") + '</span>';
      $('告警区').innerHTML = ''; $('跳过区').innerHTML = '';
      return;
    }
    const 在跑总 = Object.values(j.在跑 || {}).reduce((a, b) => a + b, 0);
    $('调度概览').innerHTML =
      '<div class="card"><div class="标">待投</div><div class="数">' + j.待投 + '</div></div>'
      + '<div class="card"><div class="标">在跑</div><div class="数">' + 在跑总 + '</div></div>'
      + '<div class="card"><div class="标">本轮可派</div><div class="数">' + (j.本轮可派 || []).length + '</div></div>'
      + '<div class="提示">并发上限 ' + 转义(JSON.stringify(j.并发上限)) + '　·　'
      + '<b>不存在后台自动连跑</b>：这里只算该派谁，真派要逐张点，每张独立过真跑三闸。</div>';

    const 告 = j.告警 || [];
    // 告警要**带着手段**。原先只有一段文字：巡检说「已在途 682 分钟，执行器可能已挂」，
    // 人看完在界面上无事可做，只能去磁盘上手挪文件。
    // 报了问题不给解法，比不报还难受——你知道它坏了，还得自己想办法。
    // 只给「在途超时」配动作：其余告警（依赖缺失/预算冻结/反复回炉）的正解都是
    // 去改单或改配置，硬塞一个按钮反而会引导人做错的事。
    const 动作 = (a) => (a.类型 === '在途超时' && a.单
      ? ' <button class="btn" onclick="退回待投(\'' + 转义(a.单) + '\')">退回待投</button>' : '');
    $('告警区').innerHTML = 告.length
      ? '<ul class="账本">' + 告.map((a) =>
        '<li><span class="' + (a.级别 === '急' ? '级急' : '级常') + '">' + 转义(a.级别) + '</span>'
        + '<b>' + 转义(a.类型) + '</b>' + (a.单 ? ' <code>' + 转义(a.单) + '</code>' : '') + '　' + 转义(a.说明)
        + 动作(a) + '</li>').join('') + '</ul>'
      : '<div class="提示">巡检无告警</div>';

    const 跳 = j.跳过 || [];
    $('跳过区').innerHTML = 跳.length
      ? '<div class="提示">本轮跳过：' + 跳.map((s) => 转义(s.id) + '（' + 转义(s.原因) + '）').join('、') + '</div>'
      : '';
  } catch {
    $('调度概览').innerHTML = '<span class="淡">' + "执行器没在 4372 应答。npm start 会带起它——单独起过 server 才会缺；也可能是它刚崩了，看终端。" + '</span>';
  }
}

// ── 路由排名 ──
async function 刷排名() {
  const 角色 = $('排名角色').value;
  try {
    const { 体: j } = await 取JSON('/api/routing/rank?role=' + encodeURIComponent(角色));
    $('区分度').innerHTML = j.有区分度
      ? '<span style="color:var(--绿)">有区分度</span>'
      : '<span style="color:var(--黄)">无区分度</span>';
    $('排名说明').textContent = j.说明 || '';
    $('排名体').innerHTML = (j.排名 || []).map((r, i) =>
      '<tr><td>' + (i === 0 ? '<b>' + 转义(r.名称) + '</b>' : 转义(r.名称)) + '</td><td>' + r.分数
      + '</td><td class="淡">' + 转义((r.理由 || []).join('　')) + '</td></tr>').join('')
      || '<tr><td colspan="3" class="淡">无候选</td></tr>';
  } catch { $('排名体').innerHTML = '<tr><td colspan="3" class="级急">路由接口不可达</td></tr>'; }
}

// ── 消耗报表 ──
// 平台会真的花钱之后，「花了多少」就不再是可选信息。账记着没人看，等于没记。
async function 刷消耗() {
  try {
    const { 码, 体: j } = await 取JSON('/api/budget');
    if (码 !== 200 || !j.ok) { $('消耗体').innerHTML = '<tr><td colspan="5" class="淡">' + 转义(j.error || '不可用') + '</td></tr>'; return; }
    $('消耗提示').textContent = j.codex提示 ? 'codex 消耗不计入' : '';
    const 千 = (n) => (n == null ? '—' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
    $('消耗体').innerHTML = (j.池 || []).map((p) => {
      const 日上限 = p.上限 && (p.上限.日token || p.上限.日金额);
      return '<tr><td><code>' + 转义(p.池) + '</code></td>'
        + '<td>' + 千(p.汇总 && p.汇总.日 && p.汇总.日.token) + '</td>'
        + '<td>' + 千(p.汇总 && p.汇总.月 && p.汇总.月.token) + '</td>'
        + '<td class="淡">' + 转义(日上限 ? '日 ' + 千(日上限) : '—') + '</td>'
        + '<td>' + (p.超 ? '<span class="级急">超</span>' : '<span style="color:var(--绿)">正常</span>') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="淡">' + 转义(j.说明 || '还没有配预算上限') + '</td></tr>';
    const 按单 = (j.按工单 || []).slice(0, 5);
    $('消耗按单').textContent = 按单.length
      ? '花得最多的单：' + 按单.map((o) => o.单 + '（' + 千(o.输入 + o.输出) + ' token，' + o.次数 + ' 次）').join('　')
      : '';
  } catch { $('消耗体').innerHTML = '<tr><td colspan="5" class="级急">预算接口不可达</td></tr>'; }
}

// ── 战绩 ──
async function 刷战绩() {
  try {
    const { 体: j } = await 取JSON('/api/routing/history?limit=50');
    const 记 = j.记录 || [];
    const 真 = 记.filter((x) => !x.dry);
    const 干 = 记.filter((x) => x.dry);
    $('真跑数').textContent = 真.length;
    $('干跑数').textContent = 干.length;
    // 成功率只算真跑：干跑必然成功，混进去这个数就没意义了
    $('成功率').textContent = 真.length ? Math.round(真.filter((x) => x.ok).length / 真.length * 100) + '%' : '—';
    $('战绩体').innerHTML = 记.slice(-12).reverse().map((x) =>
      '<tr><td class="淡">' + 转义(String(x.at || '').slice(5, 19).replace('T', ' ')) + '</td>'
      + '<td>' + 转义(x.provider) + '</td><td><code>' + 转义(x.ticket || '') + '</code></td>'
      + '<td>' + (x.dry ? '<span class="淡">干跑</span>' : (x.ok ? '<span style="color:var(--绿)">成</span>' : '<span class="级急">败</span>'))
      + '</td><td class="淡">' + 秒(x.durationMs) + '</td></tr>').join('')
      || '<tr><td colspan="5" class="淡">还没有运行记录</td></tr>';
  } catch { $('战绩体').innerHTML = '<tr><td colspan="5" class="级急">战绩接口不可达</td></tr>'; }
}

// ── Providers ──
async function 刷providers() {
  try {
    const { 体: j } = await 取JSON('/api/providers');
    if (!j.ok) { $('表体').innerHTML = '<tr><td colspan="5" class="级急">' + 转义(j.error) + '</td></tr>'; return; }
    $('表体').innerHTML = j.providers.map((p) =>
      '<tr><td><code>' + 转义(p.名称) + '</code></td><td>' + 转义(p.adapter || '') + '</td><td>' + (p.启用 ? '✔' : '✘')
      + '</td><td class="淡">' + 转义(p.说明 || '') + '</td><td><button class="btn" onclick="回声测(\'' + 转义(p.名称) + '\')">echo 桩测</button></td></tr>'
    ).join('');
  } catch { $('表体').innerHTML = '<tr><td colspan="5" class="级急">providers 接口不可达</td></tr>'; }
}

async function 回声测(名) {
  $('回声区').style.display = '';
  $('回声').textContent = '调用中…';
  try {
    const { 体: j } = await 取JSON('/api/providers/echo', {
      method: 'POST', body: JSON.stringify({ provider: 名, prompt: 'echo 联测 ' + new Date().toISOString() }),
    });
    $('回声').textContent = JSON.stringify(j, null, 2);
  } catch (e) { $('回声').textContent = '调用失败：' + e.message; }
}

// ── 瞭望塔 ──
async function 刷瞭望塔() {
  try {
    const { 体: j } = await 取JSON('/api/watchtower');
    const 在 = j.心跳 && j.心跳.在岗;
    $('灯').className = '灯 ' + (在 ? '绿' : '红');
    $('灯文').textContent = 在 ? '在岗' : '离岗';
    $('灯注').textContent = (j.心跳 && j.心跳.说明) || (j.拉起命令 ? '拉起：' + j.拉起命令 : '');
    const 未 = j.未读 || { 总数: 0, 条目: [] };
    $('账本计数').textContent = '（共 ' + 未.总数 + ' 条）';
    $('账本').innerHTML = (未.条目 || []).slice(-10).reverse().map((c) =>
      '<li><span class="' + (c.级别 === '急' ? '级急' : '级常') + '">' + 转义(c.级别 || '常') + '</span>' + 转义(c.摘要 || c.原文 || JSON.stringify(c)) + '</li>'
    ).join('') || '<li class="淡">暂无未读</li>';
  } catch { $('灯文').textContent = '读取失败'; }
}

// ── 角色下拉：从 /api/health 拿不到，用固定词表（与 plan.js 契约一致）──
const 角色表 = ['backend', 'frontend', 'integrator', 'reviewer', 'orchestrator'];
for (const 选 of ['新角色', '排名角色']) {
  $(选).innerHTML = 角色表.map((r) => '<option>' + r + '</option>').join('');
}
$('排名角色').value = 'backend';
$('滤状态').onchange = 刷工单;
$('新角色').onchange = 换模板;

刷健康(); 刷工单(); 刷调度(); 刷排名(); 刷战绩(); 刷消耗(); 刷providers(); 刷瞭望塔();
setInterval(刷瞭望塔, 5000);
setInterval(刷健康, 30000);

// ── 主题切换 ──
// 记忆在 localStorage，且 index.html 的 <head> 里在样式表加载前就把 data-theme 钉上，
// 否则暗色下每次刷新会先闪一下白纸——那是 studio 踩过的坑，直接沿用它的做法。
function 切主题() {
  const 现 = document.documentElement.dataset.theme === 'glass' ? 'paper' : 'glass';
  document.documentElement.dataset.theme = 现;
  try { localStorage.setItem('platform-theme', 现); } catch (e) { /* 隐私模式下写不进，不致命 */ }
  $('主题钮').textContent = 现 === 'glass' ? '☀' : '◐';
}
try {
  $('主题钮').textContent = document.documentElement.dataset.theme === 'glass' ? '☀' : '◐';
} catch (e) { /* 元素还没渲染 */ }

// ── 自检徽章 ──
// 把「这台机器现在能干到哪一步」摆在标题栏。首次使用最常见的困惑是
// 「我点了没反应」，而根因多半是某份本地配置没配——徽章让它一眼可见。
async function 刷自检() {
  try {
    const { 体: j } = await 取JSON('/api/selfcheck');
    const 徽 = $('自检徽');
    const 色 = { 全链路就绪: 'ok', 能执行不能提交: 'warn', 干跑可用: 'warn', 未就绪: 'red' }[j.级别] || 'mut';
    徽.className = 'pill ' + 色;
    徽.textContent = j.级别;
    徽.title = j.一句话 + '\n\n' + (j.能力 || [])
      .map((c) => (c.就绪 ? '✓ ' : '✗ ') + c.能力 + (c.就绪 ? '' : '　缺：' + (c.缺 || '')))
      .join('\n');
  } catch { /* 服务没起时标题栏保持空，健康行已经会报了 */ }
}
刷自检();
setInterval(刷自检, 60000);
