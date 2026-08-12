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
    const 参 = (滤 ? '?state=' + encodeURIComponent(滤) : '') + 项目参(滤 ? '&' : '?');
    const { 码, 体: j } = await 取JSON('/api/tickets' + 参);
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
  // 项目下拉现填，并默认选中顶栏当前选的那个：在某个项目上干活时建的单，
  // 十有八九属于那个项目。让人每次重选一遍是白费一次点击，还容易漏选。
  const 当前 = 取选中项目();
  const 就绪的 = 项目表.filter((p) => p.就绪);
  $('新项目').innerHTML = '<option value="">（不带项目：只跑不提交）</option>'
    + 就绪的.map((p) => '<option value="' + 转义(p.名) + '"'
      + (p.名 === 当前 ? ' selected' : '') + '>' + 转义(p.名) + '</option>').join('');
  // 不就绪的项目不进下拉：选了它建单会被服务端拒（校验走同一份注册表），
  // 摆在那里只是让人白点一次。
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
    // 疑似卡死单独顶出来，并带上动作按钮。
    // 把它埋在「本轮跳过」那一长串里等于没说：那段话每张单都重复一遍同样的归因，
    // 读到第三遍人就跳过去了，而这才是整轮派不出去的**唯一原因**。
    const 卡 = j.疑似卡死 || [];
    $('跳过区').innerHTML = (卡.length
      ? '<div class="提示"><span class="级急">额度被占</span>'
        + 卡.map((x) => '<code>' + 转义(x.id) + '</code>（' + (x.分钟 == null ? '无派单时间' : '已 ' + x.分钟 + ' 分钟')
          + '，池 ' + 转义(x.池) + '）<button class="btn" onclick="退回待投(\'' + 转义(x.id) + '\')">退回待投</button>').join('　')
        + '<br>它还占着并发额度——确认那次执行真停了，退回待投就能把额度放出来。</div>'
      : '')
      + (跳.length
        // 带归因的那几条在这里只显示短原因——归因上面已经讲过一遍并配了按钮，
        // 每张单再重复一遍同样的长句，读到第三遍人就整段跳过去了。
        // 完整归因仍在接口的 原因 字段里，命令行调用方拿得到。
        ? '<div class="提示">本轮跳过：' + 跳.map((s) =>
          转义(s.id) + '（' + 转义(String(s.原因).split('——')[0]) + '）').join('、') + '</div>'
        : '');
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
    // 项目在前、工单在后。「这个项目花了多少」是先问的那个问题——
    // 工单级明细只有在知道是哪个项目超了之后才有用。
    const 按项 = j.按项目 || [];
    $('消耗按单').innerHTML =
      (按项.length
        ? '<div>按项目：' + 按项.map((o) => '<b>' + 转义(o.项目) + '</b> ' + 千(o.输入 + o.输出)
          + ' token（' + o.单数 + ' 张单，' + o.次数 + ' 次）').join('　') + '</div>'
        : '')
      + (按单.length
        ? '<div>花得最多的单：' + 按单.map((o) => 转义(o.单) + '（' + 千(o.输入 + o.输出) + ' token，' + o.次数 + ' 次）').join('　') + '</div>'
        : '');
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

// ⚠ 开机调用**不在这里**，在文件末尾那个 async 自执行里。
//
// 原先就在这一行，协-007 加项目筛之后当场炸了：刷工单() 会用到 项目参，
// 而那是文件末尾的一个 const —— 函数声明会提升，const 不会（暂时性死区），
// 于是这里调用时它还不存在，抛 ReferenceError，被 刷工单 自己的 catch 吞掉，
// 显示成「工单接口不可达」。**接口好好的**，人会去查服务端、查端口、查门禁，
// 全都对，而真因在前端的声明顺序上。
//
// 所以开机调用统一挪到末尾：那里所有声明都已就位，不必每加一个模块级常量
// 就回来数一遍谁在谁前面。
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

// ══════════════════════════════════════════════════════════════
// 页签路由（协-006）
// ══════════════════════════════════════════════════════════════
// 原先整个产品是一页往下滚。加了流程与知识库两块之后滚不完了，
// 而且「我刚才看的是哪儿」在刷新后就丢了。照 studio 的做法走 hash 路由：
// 地址栏能回到同一页，刷新不丢位置，浏览器的前进后退也照常用。
const 页表 = { '': '驾驶舱', '/': '驾驶舱', '/flow': '流程', '/wiki': '知识库' };

function 当前页() {
  const h = (location.hash || '').replace(/^#/, '');
  return 页表[h] || '驾驶舱';
}

function 切页() {
  const 页 = 当前页();
  for (const 名 of ['驾驶舱', '流程', '知识库']) {
    const el = $('页-' + 名);
    if (el) el.style.display = 名 === 页 ? '' : 'none';
  }
  for (const a of document.querySelectorAll('#页签 a')) {
    a.classList.toggle('在', a.dataset.页 === 页);
  }
  // 进哪页才拉哪页的数据。三页全开着定时器的话，看知识库时后台还在每 10 秒
  // 打一遍工单接口——白费，而且真跑时那些请求会跟执行抢日志。
  if (页 === '流程') 刷流程();
  if (页 === '知识库') 刷知识分区();
}
window.addEventListener('hashchange', 切页);

// ══════════════════════════════════════════════════════════════
// 流程页
// ══════════════════════════════════════════════════════════════
async function 刷流程() {
  try {
    const { 码, 体: j } = await 取JSON('/api/flow' + 项目参('?'));
    if (码 !== 200) {
      $('流程小结').innerHTML = '<div class="提示 级急">' + 转义(j.error || ('HTTP ' + 码)) + '</div>';
      $('状态机').innerHTML = ''; $('流程层').innerHTML = '';
      return;
    }
    const s = j.小结 || {};
    // 「依赖缺失」单独给红：其余两项是正常的产线状态，它不是——
    // 那些单永远不会就绪，摆在一起会被当成「等等就好了」。
    $('流程小结').innerHTML =
      '<div class="卡"><div class="淡">在办</div><div class="数">' + s.在办 + '</div></div>'
      + '<div class="卡"><div class="淡">就绪可派</div><div class="数">' + s.就绪 + '</div></div>'
      + '<div class="卡"><div class="淡">等上游</div><div class="数">' + s.等上游 + '</div></div>'
      + (s.依赖缺失 ? '<div class="卡 坏"><div class="淡">依赖缺失</div><div class="数">' + s.依赖缺失 + '</div></div>' : '');

    // 状态机：表驱动写在代码里，用的人看不见。画出来，顺带把每态几张摆上。
    $('状态机').innerHTML = '<div class="流程带">' + (j.状态机 || []).map((x, i) =>
      '<div class="流程节' + (x.张数 ? '' : ' 空') + '">'
      + '<div class="态 ' + 转义(x.状态) + '">' + 转义(x.状态) + '</div>'
      + '<div class="数">' + x.张数 + '</div>'
      + (x.去向.length ? '<div class="淡">→ ' + x.去向.map(转义).join(' / ') + '</div>' : '<div class="淡">终态</div>')
      + '</div>' + (i < j.状态机.length - 1 ? '<div class="流程箭">›</div>' : '')).join('') + '</div>';

    const 层 = j.层 || [];
    $('流程层').innerHTML = 层.length ? 层.map((l) =>
      '<h3 class="层头">第 ' + l.深度 + ' 层 <span class="淡">' + 转义(l.说明) + '　' + l.工单.length + ' 张</span></h3>'
      + '<table><tbody>' + l.工单.map((t) => {
        const k = t.卡因 || {};
        const 色 = k.类型 === '依赖缺失' ? '级急' : (k.类型 === '就绪' ? 'okc' : '淡');
        return '<tr>'
          + '<td><a href="#/flow" onclick="看单(\'' + 转义(t.id) + '\');return false"><code>' + 转义(t.id) + '</code></a></td>'
          + '<td><span class="态 ' + 转义(t.状态) + '">' + 转义(t.状态) + '</span></td>'
          + '<td><span class="角色 ' + 转义(t.角色) + '">' + 转义(t.角色) + '</span></td>'
          + '<td>' + 转义(t.标题) + '</td>'
          + '<td class="' + 色 + '">' + 转义(k.说 || '') + '</td>'
          + '</tr>';
      }).join('') + '</tbody></table>').join('')
      : '<div class="提示">没有在办的单。完成的单不铺在这里——想看历史去看板筛「完成」。</div>';
  } catch (e) {
    $('流程小结').innerHTML = '<div class="提示 级急">流程接口不可达：' + 转义(e.message) + '</div>';
  }
}

// ══════════════════════════════════════════════════════════════
// 知识库页
// ══════════════════════════════════════════════════════════════
let 知识区 = '';

async function 刷知识分区() {
  if ($('知识分区').dataset.已载) return;              // 分区表是静态的，拉一次够了
  try {
    const { 体: j } = await 取JSON('/api/knowledge');
    $('知识分区').innerHTML = (j.分区 || []).map((z) =>
      '<button class="btn" title="' + 转义(z.说) + '" onclick="选知识区(\'' + 转义(z.键) + '\')">' + 转义(z.键) + '</button>').join('');
    $('知识分区').dataset.已载 = '1';
    if (!知识区 && (j.分区 || []).length) 选知识区(j.分区[0].键);
  } catch (e) { $('知识分区').innerHTML = '<span class="提示 级急">知识库接口不可达</span>'; }
}

async function 选知识区(区) {
  知识区 = 区;
  for (const b of document.querySelectorAll('#知识分区 button')) {
    b.classList.toggle('accent', b.textContent === 区);
  }
  $('知识目录').innerHTML = '<div class="提示">读取中…</div>';
  try {
    const { 码, 体: j } = await 取JSON('/api/knowledge?区=' + encodeURIComponent(区));
    if (码 !== 200) { $('知识目录').innerHTML = '<div class="提示 级急">' + 转义(j.error) + '</div>'; return; }
    $('知识目录').innerHTML =
      '<div class="提示">' + 转义(j.说) + '<br><code>' + 转义(j.目录) + '/</code>　' + j.条数 + ' 篇</div>'
      + '<ul class="知识目">' + (j.文档 || []).map((d) =>
        '<li><a href="#/wiki" onclick="读知识(\'' + 转义(区) + '\',\'' + 转义(d.rel) + '\');return false">'
        + 转义(d.标题) + '</a><div class="淡">' + 转义(d.rel) + '</div></li>').join('') + '</ul>';
  } catch (e) { $('知识目录').innerHTML = '<div class="提示 级急">' + 转义(e.message) + '</div>'; }
}

async function 读知识(区, rel) {
  $('知识正文').innerHTML = '<div class="提示">读取中…</div>';
  try {
    const { 码, 体: j } = await 取JSON('/api/knowledge/file?区=' + encodeURIComponent(区) + '&rel=' + encodeURIComponent(rel));
    if (码 !== 200) { $('知识正文').innerHTML = '<div class="提示 级急">' + 转义(j.error) + '</div>'; return; }
    $('知识正文').innerHTML = '<div class="文头"><b>' + 转义(j.标题) + '</b>　<code class="淡">' + 转义(j.rel) + '</code></div>'
      + '<article class="md">' + 渲染md(j.正文) + '</article>';
    $('知识正文').scrollTop = 0;
  } catch (e) { $('知识正文').innerHTML = '<div class="提示 级急">' + 转义(e.message) + '</div>'; }
}

// 极简 markdown → HTML。
//
// ⚠ **顺序是安全边界，不是风格问题**：必须先整体转义，再往转义后的文本上套格式。
// 反过来（先套格式再转义，或只转义一部分）就等于把文件内容当 HTML 执行。
// 这些文件里有大量 <script>、<!--blk--> 之类的字面量，而知识库读的是磁盘上的文件——
// 谁能往那几个目录写文件，谁就能在这个页面上执行脚本。
//
// 为什么手写不引库：运行时零第三方依赖是既定口径。代价是只支持一个子集——
// 标题、列表、围栏代码、行内代码、粗体、引用、水平线。表格与图片不支持，
// 原样显示成文本，**不假装渲染成功**。
function 渲染md(原文) {
  const 行 = 转义(String(原文 || '')).split(/\r?\n/);
  const 出 = [];
  let 在码块 = false; let 在列表 = false;
  let i = -1;                                  // 表格要往前看一行，所以得有下标
  const 收列表 = () => { if (在列表) { 出.push('</ul>'); 在列表 = false; } };
  const 行内 = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // 表格。原先不支持，说明书那几篇整页都是表，吐出来一堆 `|---|---|---|`
  // ——那行是纯噪音，人得在竖线里自己数列。「不假装渲染成功」是诚实的兜底，
  // 但这里真正该做的是支持它，而不是把诚实当成不做的理由。
  const 是表行 = (s) => /^\s*\|.*\|\s*$/.test(s || '');
  const 是分隔行 = (s) => /^\s*\|[\s:|-]+\|\s*$/.test(s || '') && /-/.test(s || '');
  const 切格 = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => 行内(c.trim()));

  while (++i < 行.length) {
    const l = 行[i];
    if (/^```/.test(l)) {
      收列表();
      出.push(在码块 ? '</code></pre>' : '<pre class="码"><code>');
      在码块 = !在码块;
      continue;
    }
    if (在码块) { 出.push(l); continue; }
    // 认表：表头行 + 分隔行。少了分隔行就不是表——正文里一句话带两个竖线
    // 也会长得像表行，只靠「有竖线」判会把普通段落吃掉。
    if (是表行(l) && 是分隔行(行[i + 1])) {
      收列表();
      const 头 = 切格(l);
      i += 2;
      const 体 = [];
      while (i < 行.length && 是表行(行[i])) { 体.push(切格(行[i])); i++; }
      i--;                                       // 退一格：外层 ++i 会再往前走
      出.push('<div class="表包"><table class="md表"><thead><tr>'
        + 头.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>'
        + 体.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { 收列表(); const n = Math.min(6, h[1].length + 2); 出.push('<h' + n + '>' + 行内(h[2]) + '</h' + n + '>'); continue; }
    if (/^\s*[-*]\s+/.test(l)) {
      if (!在列表) { 出.push('<ul>'); 在列表 = true; }
      出.push('<li>' + 行内(l.replace(/^\s*[-*]\s+/, '')) + '</li>');
      continue;
    }
    收列表();
    // 转义之后 `>` 已经变成 &gt;，引用行要按转义后的形态认——
    // 照着原文写 /^>/ 会一条都匹配不上，而且不会报错，只是引用块永远不出现。
    if (/^\s*&gt;\s?/.test(l)) { 出.push('<blockquote>' + 行内(l.replace(/^\s*&gt;\s?/, '')) + '</blockquote>'); continue; }
    if (/^\s*(-{3,}|={3,})\s*$/.test(l)) { 出.push('<hr>'); continue; }
    if (!l.trim()) { 出.push(''); continue; }
    出.push('<p>' + 行内(l) + '</p>');
  }
  收列表();
  if (在码块) 出.push('</code></pre>');       // 文件里围栏没闭合也不能把后面的内容吞掉
  return 出.join('\n');
}

// 开机顺序有讲究：先把项目表拉下来，再切页。
// 反过来的话，切页会先按「全部项目」渲一遍，项目表到了再渲一遍——闪一下。
// 包在 async 自执行里：**顶层 await 在浏览器的经典脚本里是语法错误**，
// 整个文件解析失败、全页静默死掉。写的时候就这么错了一次，被接线契约的
// 「驾驶舱脚本语法必须合法」当场抓住（node --check 反而放过了它）。


// ══════════════════════════════════════════════════════════════
// 项目（协-007）：项目是全局作用域，不是看板的一个筛选条件
// ══════════════════════════════════════════════════════════════
// 选定一个项目后，看板、流程、建单默认值都跟着走。所以选择器在顶栏，
// 不在看板的筛选条里——放看板里会让人以为它只管那一张表。
//
// 选择记在 localStorage：这是「我现在在哪个项目上干活」，跨刷新、跨页签都该保持。
// 记在 URL 里更「正确」，但每次切页都要拼参数，而且用户手打的链接会丢掉它。
let 项目表 = [];
const 取选中项目 = () => { try { return localStorage.getItem('platform-项目') || ''; } catch { return ''; } };
const 存选中项目 = (v) => { try { localStorage.setItem('platform-项目', v); } catch { /* 隐私模式 */ } };
// 拼查询串。空 = 全部，不带这个参数。
const 项目参 = (前缀) => {
  const v = 取选中项目();
  return v ? 前缀 + '项目=' + encodeURIComponent(v) : '';
};

async function 刷项目() {
  try {
    const { 体: j } = await 取JSON('/api/projects');
    项目表 = j.项目 || [];
    const 选 = $('项目选');
    const 当前 = 取选中项目();
    // 「(无项目)」是个真实类别不是「全部」的同义词：不带项目的单只跑不提交，
    // 它们是一群需要单独看见的单。
    选.innerHTML = '<option value="">全部项目</option>'
      + 项目表.map((p) => '<option value="' + 转义(p.名) + '"' + (p.名 === 当前 ? ' selected' : '') + '>'
        + (p.就绪 ? '' : '⚠ ') + 转义(p.名) + '</option>').join('')
      + '<option value="(无项目)"' + (当前 === '(无项目)' ? ' selected' : '') + '>（无项目）</option>'
      + '<option value="__新增__">＋ 登记项目…</option>';
    // 选中的项目不在表里了（改过配置/换了机器）——静默留着会让看板永远空着，
    // 而人看不出为什么。退回全部并说一声。
    if (当前 && 当前 !== '(无项目)' && !项目表.some((p) => p.名 === 当前)) {
      存选中项目(''); 选.value = '';
      alert('原先选的项目「' + 当前 + '」已不在注册表里，已退回「全部项目」。');
    }
    const 坏 = 项目表.filter((p) => !p.就绪);
    选.title = 项目表.length
      ? '项目 = 一个 git 仓。选定后看板与流程只看这个项目。'
        + (坏.length ? '\n\n⚠ 有问题的项目：\n' + 坏.map((p) => p.名 + '：' + p.说).join('\n') : '')
      : '还没登记任何项目。选「＋ 登记项目…」';
  } catch { /* 服务没起时健康行已经会报 */ }
}

async function 换项目() {
  const v = $('项目选').value;
  if (v === '__新增__') { $('项目选').value = 取选中项目(); 开登记项目(); return; }
  存选中项目(v);
  刷工单();
  if (当前页() === '流程') 刷流程();
}

// 登记一个项目。与工单库落位同一个路子：位置人给，产品只负责收好并挡住危险的那几种。
async function 开登记项目() {
  const 名 = prompt('项目名（工单的「项目」字段填这个）：');
  if (!名) return;
  const 路径 = prompt('这个项目的 git 仓根目录（绝对路径）：\n\n'
    + '注册表同时是**写操作白名单**——登记它就等于允许 AI 往这个仓里提交。');
  if (!路径) return;
  try {
    const { 码, 体: j } = await 取JSON('/api/setup/project', {
      method: 'POST', body: JSON.stringify({ 名, 路径 }),
    });
    if (码 !== 200 || !j.ok) { alert('登记失败：\n\n' + (j.error || ('HTTP ' + 码))); return; }
    存选中项目(j.名);
    await 刷项目();
    刷工单();
    alert('已登记 ' + j.名 + '\n→ ' + j.路径 + (j.覆盖 ? '\n\n（覆盖了同名的旧登记）' : ''));
  } catch (e) { alert('登记失败：' + e.message); }
}

// ══════════════════════════════════════════════════════════════
// 开机（必须是本文件的最后一段）
// ══════════════════════════════════════════════════════════════
// 位置是硬要求，不是风格：上面用到的模块级常量（项目表、项目参…）都是 const/let，
// 不会像函数声明那样提升。开机段放在它们**前面**的话，调用时撞暂时性死区，
// 抛 ReferenceError，而各个刷新函数自己的 catch 会把它吞成「接口不可达」——
// 接口好好的，人却会去查服务端、端口、门禁，全都对。协-007 实测踩了两次。
(async () => {
  $('项目选').onchange = 换项目;
  // 项目表要先到：看板与流程的取数都带项目参数，晚一步会先按「全部」渲一遍再重渲。
  await 刷项目();
  刷健康(); 刷工单(); 刷调度(); 刷排名(); 刷战绩(); 刷消耗(); 刷providers(); 刷瞭望塔();
  切页();
})();
