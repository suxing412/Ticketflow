'use strict';
const $ = (id) => document.getElementById(id);
const 秒 = (n) => (n == null ? '—' : Math.round(n / 1000) + 's');
const 转义 = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const 取JSON = (u, o) => fetch(u, o).then((r) => r.json().then((j) => ({ 码: r.status, 体: j })));

// ══════════════════════════════════════════════════════════════
// 交互反馈基建（协-012）
// ══════════════════════════════════════════════════════════════
// 把 studio 领先的那部分抄过来。它领先的**不是功能，是「机器在动」的质感**：
// 同样一次操作，platform 用 alert 糊你一脸浏览器弹窗，studio 飘一条吐司；
// platform 整页重绘导致滚动位置和输入焦点全丢，studio 只改动变了的那几个节点。
//
// 这些东西单独看都很小，加起来决定了「像个产品」还是「像个调试页面」。

// ── 吐司：不打断的反馈 ──
// 原先全站用 alert()。原生弹窗有三个硬伤，每一个都在削弱信任：
//   ① 阻塞整个页面，后台刷新全停；
//   ② 长得跟浏览器报错一模一样，成功提示也像出事了；
//   ③ 标题栏写着「127.0.0.1 显示」——像个网页脚本，不像个软件。
function 吐(消息, 类 = '') {
  const t = document.createElement('div');
  t.className = '吐司 ' + 类;
  t.textContent = String(消息 || '');
  document.body.appendChild(t);
  // 出错的多留一会儿：报错要读，成功只需扫一眼
  setTimeout(() => { t.classList.add('去'); setTimeout(() => t.remove(), 260); }, 类 === '坏' ? 4200 : 2200);
  return t;
}

// ── 确认框：自己画，不用 confirm() ──
// 除了上面三条，原生 confirm 还有一条致命的：**它不能排版**。
// 本产品的确认文案里有「订阅额度 / 会计费」这种必须一眼分得清的信息，
// 挤在一坨纯文本里等于没写。这个能给危险动作单独上色。
function 问(标题, 正文, { 危险 = false, 确认字 = '确定', 取消字 = '取消' } = {}) {
  return new Promise((定) => {
    const 罩 = document.createElement('div');
    罩.className = '罩';
    罩.innerHTML =
      '<div class="问框" role="dialog" aria-modal="true" aria-label="' + 转义(标题) + '">'
      + '<div class="问题">' + 转义(标题) + '</div>'
      + '<div class="问文">' + 正文 + '</div>'
      + '<div class="问钮">'
      + '<button class="btn" data-选="否">' + 转义(取消字) + '</button>'
      + '<button class="btn ' + (危险 ? 'danger-o' : 'accent') + '" data-选="是">' + 转义(确认字) + '</button>'
      + '</div></div>';
    const 收 = (v) => { 罩.remove(); document.removeEventListener('keydown', 键); 定(v); };
    const 键 = (e) => {
      if (e.key === 'Escape') 收(false);
      // 回车不绑「确认」：危险动作要有意去点那个按钮。
      // 顺手一个回车就把钱花出去，是这里最不该发生的事。
    };
    罩.onclick = (e) => { if (e.target === 罩) 收(false); };
    罩.querySelector('[data-选="否"]').onclick = () => 收(false);
    罩.querySelector('[data-选="是"]').onclick = () => 收(true);
    document.addEventListener('keydown', 键);
    document.body.appendChild(罩);
    // 焦点落在取消上：默认答案是「不」。危险操作的默认值必须是不做。
    罩.querySelector('[data-选="否"]').focus();
  });
}

// ── 相对时间 ──
// 「2026-08-12T09:07:10.537Z」对人是无意义的。人要知道的是「多久以前」。
function 多久(时刻) {
  const t = Date.parse(时刻 || '');
  if (!Number.isFinite(t)) return '—';
  const 秒数 = Math.floor((Date.now() - t) / 1000);
  if (秒数 < 0) return '刚刚';
  if (秒数 < 60) return 秒数 + ' 秒前';
  if (秒数 < 3600) return Math.floor(秒数 / 60) + ' 分钟前';
  if (秒数 < 86400) return Math.floor(秒数 / 3600) + ' 小时前';
  const 天 = Math.floor(秒数 / 86400);
  return 天 < 30 ? 天 + ' 天前' : new Date(t).toLocaleDateString('zh-CN');
}

// ── 空态卡 ──
// 空表格里塞一句「还没有工单」是**浪费掉的一次机会**：人第一次打开时看到的正是空态，
// 而那一刻他最需要知道的是「那我该干什么」。给一句下一步，比一句陈述有用。
function 空态(标题, 说明, 动作) {
  return '<div class="空卡"><h5>' + 转义(标题) + '</h5>'
    + (说明 ? '<p>' + 说明 + '</p>' : '')
    + (动作 ? '<div class="空钮">' + 动作 + '</div>' : '')
    + '</div>';
}

// ── 增量刷新 ──
// 原先每次刷新都 innerHTML 整块重写，代价是：滚动位置跳回去、输入框里打了一半的字没了、
// 展开的详情自己收起来。定时刷新每 10 秒发生一次，等于每 10 秒打断人一次。
//
// 只改真正变了的节点。这不是性能优化——是**不打断正在操作的人**。
function 换(目标, html) {
  if (!目标) return;
  const 焦 = document.activeElement;
  const 焦id = 焦 && 焦.id;
  let 选区 = null;
  if (焦 && /^(INPUT|TEXTAREA)$/.test(焦.tagName)) {
    try { 选区 = [焦.selectionStart, 焦.selectionEnd]; } catch { /* 某些 type 没有选区 */ }
  }
  const 临 = document.createElement('div');
  临.innerHTML = html;
  换子(目标, 临);
  // 兜底：整段被替换时焦点会掉，按 id 认回来
  if (焦id && document.activeElement !== 焦) {
    const el = $(焦id);
    if (el && el.focus) {
      el.focus();
      if (选区) { try { el.setSelectionRange(选区[0], 选区[1]); } catch { /* 同上 */ } }
    }
  }
}

function 换子(旧父, 新父) {
  const 旧 = [...旧父.childNodes];
  const 新 = [...新父.childNodes];
  for (let i = 0; i < 新.length; i++) {
    const a = 旧[i]; const b = 新[i];
    if (!a) { 旧父.appendChild(b.cloneNode(true)); continue; }
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { 旧父.replaceChild(b.cloneNode(true), a); continue; }
    if (a.nodeType === 3) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; continue; }
    if (a.nodeType !== 1) continue;
    // 属性对齐
    for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    // 正在被编辑的输入框**不碰它的值**——那是人手里的东西，不是我们该覆盖的
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.nodeName) && document.activeElement === a) continue;
    换子(a, b);
  }
  for (let i = 新.length; i < 旧.length; i++) 旧父.removeChild(旧[i]);
}


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
    // 「全部」不含已归档——**这条在服务端做**（server.js 的 /api/tickets）。
    // 前端不再重复过滤一遍：同一件事两处各做一遍，迟早一处改了另一处没改，
    // 而且命令行调用方绕不过前端那份。
    if (!j.工单 || !j.工单.length) {
      // 空态是**第一次打开时唯一看得见的东西**。一句「还没有工单」等于把这个
      // 位置浪费掉——那一刻人最需要知道的是「那我该干什么」。
      $('工单体').innerHTML = '<tr><td colspan="7">' + (滤
        ? 空态('「' + 滤 + '」里没有单',
          滤 === '已归档' ? '归档过的单会出现在这里，随时能取回。' : '换个状态看看，或者把筛选清成「全部」。')
        : 空态('还没有工单',
          '工单是这台机器的输入：一段 Markdown 说清要做什么、验收标准是什么，'
          + '平台按角色挑一个 AI 去做，做完由<b>另一个厂商的模型</b>判一次。'
          + '<br>已归档的单不在这里——用上面的筛选看。',
          '<button class="btn accent" onclick="开建单()">＋ 建第一张单</button>'))
        + '</td></tr>';
      return;
    }
    const 序 = { 草稿: 0, 待投: 1, 在途: 2, 质检: 3, 完成: 4, 已归档: 5 };
    // 先按状态，再让子单紧跟父单——DAG 平铺在列表里就看不出结构了。
    const 键 = (t) => ((t.fm && t.fm.父单) ? t.fm.父单 + '' + t.id : t.id);
    j.工单.sort((a, b) => (序[a.state] - 序[b.state]) || 键(a).localeCompare(键(b)));
    // 增量刷新：整块 innerHTML 会把滚动位置、输入焦点、展开的详情全冲掉。
    // 看板是人一直盯着的地方，每次刷新都跳一下等于每次都打断他。
    换($('工单体'), j.工单.map((t) => {
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
        // 按钮的字与颜色跟着**这个池的计费模式**走：走订阅额度的那一次不额外花钱，
        // 就不该叫「花钱」，也不该是红的。红色留给真会多花钱的——
        // 对着不花钱的按钮天天见红，人会对红色脱敏，等真该紧张时反而没反应。
        + (可派 ? '<button class="btn" onclick="跑(\'' + 转义(t.id) + '\',true)">干跑</button> '
                + '<button class="' + 真跑钮类(f.执行池) + '" onclick="跑(\'' + 转义(t.id) + '\',false)">'
                + 转义(真跑标签(f.执行池, '真跑')) + '</button>' : '')
        + (可退 ? '<button class="btn" onclick="退回待投(\'' + 转义(t.id) + '\')">退回待投</button>' : '')
        + (可判 ? '<button class="btn" onclick="判(\'' + 转义(t.id) + '\',true)">试判</button> '
                + '<button class="' + 真跑钮类(f.执行池) + '" onclick="判(\'' + 转义(t.id) + '\',false)">'
                + 转义(真跑标签(f.执行池, '真判')) + '</button>' : '')
        // 归档：每张单都能归，包括在途的（跑挂了、需求取消了都算）。
        // 已归档的单给一条回头路——归档不可逆的话人就不敢用它，只会继续攒着。
        + (t.state === '已归档'
          ? '<button class="btn" onclick="迁移(\'' + 转义(t.id) + '\',\'草稿\')">取回</button>'
          : '<button class="btn" onclick="归档(\'' + 转义(t.id) + '\')" title="从看板挪走，记录留着">归档</button>')
        + '</td></tr>';
    }).join(''));
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
  // 危险样式：这个动作有个隐蔽的坏情况——若那次执行其实还活着，
  // 重派会让两个 agent 同时改同一片代码。红色是给这条用的。
  if (!await 问('退回 ' + id + ' 到待投？',
    '<p>之后可以重新派活。</p>'
    + '<p class="级急">先确认那次执行真的已经停了。</p>'
    + '<p>巡检只能看见「很久没动静」，推断不出进程死没死。若它还活着，'
    + '重派会让<b>两个 agent 同时改同一片代码</b>。</p>',
    { 危险: true, 确认字: '退回待投' })) return;
  const { 体: j } = await 取JSON('/api/tickets/' + encodeURIComponent(id) + '/move', {
    method: 'POST', body: JSON.stringify({ 到: '待投' }),
  });
  if (!j.ok) { 吐('退回失败：' + j.error, '坏'); return; }
  刷工单(); 刷调度();
}

// 归档：把单从看板挪走，记录留着。
//
// 这是「删掉它」的正规入口。此前工单库只能建不能销，人想清掉一张废单
// 只能去磁盘上 rm 文件——绕过产品，账本还会留下对不上号的记录
// （实测：删掉的单，「反复回炉」告警永远消不掉）。
//
// 多问一句，因为有一种情况会丢东西：**在途的单归档，那次执行还在跑**。
// 平台看不见 CLI 进程死没死，归档不会去杀它。
async function 归档(id) {
  const 行 = [...document.querySelectorAll('#工单体 tr')].find((tr) => tr.textContent.includes(id));
  const 态 = 行 ? ((行.querySelector('.态') || {}).textContent || '').trim() : '';
  const 话 = 态 === '在途'
    ? '这张单**正在途**。归档不会去杀那个 CLI 进程——平台看不见它死没死。\n'
      + '若它还在跑，跑完的产出会落在一张已归档的单上，没人会去看。\n\n'
    : '';
  if (!await 问('归档 ' + id + '？',
    '<p>从看板挪走，<b>记录与账本都留着</b>，随时可以「取回」。</p>'
    + (话 ? '<p class="级急">' + 转义(话) + '</p>' : ''),
    { 危险: !!话, 确认字: '归档' })) return;
  const { 体: j } = await 取JSON('/api/tickets/' + encodeURIComponent(id) + '/move', {
    method: 'POST', body: JSON.stringify({ 到: '已归档' }),
  });
  if (!j.ok) { 吐('归档失败：' + j.error, '坏'); return; }
  刷工单(); 刷调度();
}

async function 迁移(id, 到) {
  const { 体: j } = await 取JSON('/api/tickets/' + encodeURIComponent(id) + '/move', {
    method: 'POST', body: JSON.stringify({ 到 }),
  });
  if (!j.ok) 吐('流转失败：' + j.error, '坏'); else 吐('已流转到「' + 到 + '」');
  刷工单();
}

async function 跑(id, 干跑, 同意计费) {
  // 真跑会改目标仓，且**可能**产生费用——两件事要分开说。
  // 走订阅额度时说「产生费用」是不实的：月费已经付了，边际成本是零。
  // 前端确认不是安全边界（服务端四闸才是），但它挡得住手滑。
  if (!干跑 && !同意计费) {
    // 池由服务端的路由器选，前端拿不到最终结果——只能按工单行上显示的那个池给提示。
    // 两者绝大多数时候一致；不一致时（降级到备选池）服务端仍会独立判一次四闸，
    // 所以这里说错了不会导致多花钱，只会让提示不够准。
    const 行 = [...document.querySelectorAll('#工单体 tr')].find((tr) => tr.textContent.includes(id));
    const 该池 = 行 ? ((行.querySelector('.池') || {}).textContent || '').trim() : '';
    const c = 计费表[该池] || {};
    let 费;
    if (该池 && c.模式) {
      费 = c.花钱 ? '⚠ ' + c.说 : c.说;
    } else {
      // 池还没定（待投单都是这样）。**逐个池如实列出来**，而不是含糊说一句
      // 「可能花钱」——人要判断的正是「这一跑会不会花钱」，含糊等于没说。
      const 全 = Object.entries(计费表);
      // 按「花不花钱」分组，但**标签要按各自的模式写**。
      // 第一版把整组叫「走订阅额度」，而 echo 是本地执行不是订阅——
      // 分组依据和标签用词不是一回事，混起来就会写出不实的话。
      const 免 = 全.filter(([, x]) => !x.花钱).map(([n, x]) => n + '（' + (x.标签 || '') + '）');
      const 花 = 全.filter(([, x]) => x.花钱).map(([n, x]) => n + '（' + (x.标签 || '') + '）');
      费 = '执行池由路由器在派活时选，现在还没定。\n'
        + (免.length ? '不额外花钱：' + 免.join('、') + '\n' : '')
        + (花.length ? '⚠ 会产生开销：' + 花.join('、') + '\n若选中了后者，服务端会先停下来再问你一次。' : '');
    }
    // 危险色只给真会多花钱的那次——同 真跑钮类 那条：
    // 对着不花钱的操作天天见红，等真该紧张时反而没反应。
    const 会花 = /会产生开销|⚠/.test(费);
    if (!await 问('真跑 ' + id + '？',
      '<p>会调用 AI CLI；工单带「项目」时还会在目标仓<b>提交并合并</b>。</p>'
      + '<div class="费框' + (会花 ? ' 花' : '') + '">' + 转义(费).split('\n').join('<br>') + '</div>',
      { 危险: 会花, 确认字: '真跑' })) return;
  }
  $('运行区').style.display = '';
  $('运行').textContent = (干跑 ? '干跑' : '真跑') + '中…（真跑可能要几十秒）';
  try {
    const { 体: j } = await 取JSON('/api/exec/run/' + encodeURIComponent(id), {
      method: 'POST', body: JSON.stringify({ 干跑, ...(同意计费 ? { 同意计费: true } : {}) }),
    });
    // 402：订阅额度用完了，继续跑要落到 API 计费。**这是唯一一次真的要问钱的地方**，
    // 所以单独弹一次，而且默认是「不花」——直接返回，不重试。
    if (j.需同意计费) {
      $('运行').textContent = j.error;
      // 全站唯一真正要问钱的地方：永远走危险样式，且取消键的字面就是「不花这笔钱」。
      if (await 问('订阅额度已耗尽，要改用 API 计费吗？',
        '<div class="费框 花">' + 转义(j.error).split('\n').join('<br>') + '</div>',
        { 危险: true, 确认字: '按 token 计费跑这一张', 取消字: '不花这笔钱' })) return 跑(id, false, true);
      刷计费();
      return;
    }
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
    吐('拿不到原始计划文本，请改用接口物化 /api/plan/materialize', '坏');
    return;
  }
  const { 体: j } = await 取JSON('/api/plan/materialize', {
    method: 'POST', body: JSON.stringify({ 输出: 原始, 父单 }),
  });
  $('运行').textContent = JSON.stringify(j, null, 2);
  刷工单(); 刷调度();
}

async function 判(id, 干跑) {
  // 说明改过：真判走的也是订阅额度，说「产生费用」是不实的（协-008 的口径）。
  if (!干跑 && !await 问('真判 ' + id + '？',
    '<p>会调用<b>另一个 Provider</b> 做质检——跨厂评审降低同源盲区。</p>'
    + '<p>判官只读不写，它拿到的是这张单交付时那个提交的 detached 快照。</p>',
    { 确认字: '真判' })) return;
  $('运行区').style.display = '';
  $('运行').textContent = (干跑 ? '试判' : '真判') + '中…';
  try {
    const { 体: j } = await 取JSON('/api/exec/qa/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ 干跑 }) });
    $('运行').textContent = JSON.stringify(j, null, 2);
  } catch (e) { $('运行').textContent = '调用失败：' + e.message; }
  刷工单(); 刷战绩(); 刷调度();
}

// 批量操作。<b>只做干跑与流转，绝不批量真跑</b>——
// 一个按钮同时把几张单跑出去，不该存在。真跑必须逐张点，每张独立过四闸。
async function 批量投出() {
  const { 体: j } = await 取JSON('/api/tickets?state=' + encodeURIComponent('草稿'));
  const 单 = (j.工单 || []).map((t) => t.id);
  if (!单.length) { 吐('没有草稿单'); return; }
  if (!await 问('把这 ' + 单.length + ' 张草稿投出？',
    '<p>投出后进入「待投」等待派活。这一步<b>不调用任何 AI</b>，只是流转。</p>'
    + '<div class="单列">' + 单.map((x) => '<code>' + 转义(x) + '</code>').join(' ') + '</div>',
    { 确认字: '投出 ' + 单.length + ' 张' })) return;
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
  if (码 !== 200) { 吐("执行器没在 4372 应答。npm start 会带起它；也可能是它刚崩了，看终端。", "坏"); return; }
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
    + '\n\n真跑请逐张点——每张独立过四闸，批量真跑不提供。';
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
      + '<b>不存在后台自动连跑</b>：这里只算该派谁，真派要逐张点，每张独立过真跑四闸。</div>';

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
      // 相对时间 + 绝对时间挂 title：「3 小时前」是人要的答案，
      // 「08-11 15:56:23」是排查时才需要的东西，鼠标停上去再给。
      '<tr><td class="淡" title="' + 转义(String(x.at || '')) + '">' + 转义(多久(x.at)) + '</td>'
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
const 页表 = { '': '驾驶舱', '/': '驾驶舱', '/flow': '流程', '/wiki': '知识库', '/hub': '项目', '/设置': '设置' };

function 当前页() {
  let h = (location.hash || '').replace(/^#/, '');
  // 浏览器会把中文 hash 百分号编码：`#/设置` 读回来是 `#/%E8%AE%BE%E7%BD%AE`，
  // 与路由表里的键对不上，于是永远落到默认页——**而且不报错**，
  // 点导航像没反应。解码之后再查表。
  // try 是必需的：地址栏里的半截百分号（人手改 URL 就会出现）会让 decode 抛。
  try { h = decodeURIComponent(h); } catch { /* 解不开就按原样查，落默认页 */ }
  return 页表[h] || '驾驶舱';
}

function 切页() {
  const 页 = 当前页();
  for (const 名 of ['驾驶舱', '流程', '知识库', '项目', '设置']) {
    const el = $('页-' + 名);
    if (el) el.style.display = 名 === 页 ? '' : 'none';
  }
  for (const a of document.querySelectorAll('#页签 a')) {
    a.classList.toggle('在', a.dataset.页 === 页);
  }
  // 进哪页才拉哪页的数据。三页全开着定时器的话，看知识库时后台还在每 10 秒
  // 打一遍工单接口——白费，而且真跑时那些请求会跟执行抢日志。
  // 驾驶舱也要在进入时重拉——它不像别的页那样每次现渲，是开机渲一次就留着的。
  // 少了这一句，从项目页切换项目跳回来，看板还是上一个项目的内容：
  // 顶栏胶囊已经变了，表格没变，两处自相矛盾。
  if (页 === '驾驶舱') { 刷工单(); 刷调度(); }
  if (页 === '流程') 刷流程();
  if (页 === '知识库') 刷知识分区();
  if (页 === '项目') 刷项目页();
  // 设置页装的是观测数据（排名/消耗/战绩/Providers/瞭望塔/账本），进去才拉。
  // 常驻驾驶舱时后台每隔几秒把这些接口全打一遍，纯属白费——
  // 而且真跑时这些请求会跟执行抢日志。
  if (页 === '设置') { 刷排名(); 刷消耗(); 刷战绩(); 刷providers(); 刷瞭望塔(); 刷账本(); 刷计费(); }
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
    // 选中的项目不在表里了（改过配置/换了机器）——静默留着会让看板永远空着，
    // 而人看不出为什么。退回全部并说一声。
    const 当前 = 取选中项目();
    if (当前 && 当前 !== '(无项目)' && !项目表.some((p) => p.名 === 当前)) {
      存选中项目('');
      吐('项目「' + 当前 + '」已不在注册表里，已退回「全部项目」', '坏');
    }
    项目胶囊();
  } catch { /* 服务没起时健康行已经会报 */ }
}

// 顶栏的下拉没了（协-009 改成项目页 + 胶囊），这里只留一个供项目页调用的入口。
async function 换项目(v) {
  存选中项目(v);
  项目胶囊();
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
    if (码 !== 200 || !j.ok) { 吐('登记失败：' + (j.error || ('HTTP ' + 码)), '坏'); return; }
    存选中项目(j.名);
    await 刷项目();
    项目胶囊();
    刷工单();
    吐('已登记 ' + j.名 + (j.覆盖 ? '（覆盖了同名旧登记）' : ''));
  } catch (e) { 吐('登记失败：' + e.message, '坏'); }
}
// ══════════════════════════════════════════════════════════════
// 计费口径（协-008）
// ══════════════════════════════════════════════════════════════
// 此前每个真跑按钮都写着「花钱」。那与实际的付费方式对不上：
// 走 Claude Pro / Codex Plus 这类订阅额度时，月费已经付了，跑一次的边际成本是零。
// 把它标成花钱，会让人不敢走本来就该走的主路径——而真正该拦的是
// **订阅耗尽之后落到 API 按 token 计费**的那一刻。
let 计费表 = {};

async function 刷计费() {
  try {
    const { 体: j } = await 取JSON('/api/exec/health');
    计费表 = j.计费 || {};
    // 落计费风险要顶出来：订阅池但环境里带着 API key，CLI 可能在耗尽后
    // 自己切到计费而平台看不见。这是唯一一个「不问就会花钱」的口子。
    const 险 = Object.values(计费表).filter((x) => x.落计费风险);
    const 位 = $('计费提示');
    if (位) {
      位.innerHTML = 险.length
        ? '<span class="级急">可能被静默计费</span>' + 转义(险[0].落计费风险)
        : '';
    }
  } catch { /* 执行器没起时调度概览已经会报 */ }
}

// 这个池的这一次跑，会不会产生新开销。拿不到计费信息时按**会**处理：
// 宁可多问一句，不可让人在不知情时被计费。
function 会花钱(池) {
  const c = 计费表[池];
  return c ? !!c.花钱 : true;
}
// 按钮上的字。订阅池就叫「真跑」——它本来就不额外花钱。
function 真跑标签(池, 前缀) {
  // 待投单**还没有执行池**——池是派活那一刻由路由器选的。
  // 此时在按钮上写任何一种计费模式都是瞎猜：第一版写「计费未声明」，
  // 结果每张待投单都顶着一个又红又错的标签，比原先那个「花钱」更糟。
  // 不知道就不装作知道；真相留给确认框（它按当下能选到的池如实说）。
  if (!池) return 前缀;
  const c = 计费表[池] || {};
  if (c.已耗尽) return 前缀 + '（额度已尽·会计费）';
  if (c.模式 === '订阅') return 前缀 + '（订阅额度）';
  if (c.模式 === 'api') return 前缀 + '（计费）';
  return 前缀 + '（计费未声明）';
}

// 池未知时，按**所有已声明的池**给一个整体判断。
// 全是订阅且都没耗尽 → 这一跑几乎肯定不花钱；只要有一个会花钱，就按会花钱说。
function 整体会花钱() {
  const 全 = Object.values(计费表);
  if (!全.length) return true;                       // 拿不到信息 → 按会花钱处理
  return 全.some((c) => c.花钱);
}
// 红色只留给真的会多花钱的。订阅池用普通描边——
// 见红就紧张是有用的信号，而对着不花钱的按钮天天见红，人会对红色脱敏，
// 等真该紧张的那次（额度耗尽后落到计费）反而没反应。
// 池未知时按整体判断，而不是一律标红：待投单全都没有池，一律标红等于全屏红。
const 真跑钮类 = (池) => ((池 ? 会花钱(池) : 整体会花钱()) ? 'btn danger-o' : 'btn');


// ══════════════════════════════════════════════════════════════
// 项目页（协-009）：项目是语境，不是一个表单控件
// ══════════════════════════════════════════════════════════════
// 原先顶栏是个 <select>。下拉把「我现在在哪个项目上干活」降格成一个筛选器，
// 而它其实决定了整个界面在讲哪个仓的事——看板、流程、建单默认值全跟着它。
// 照 studio 的做法改：项目是**页上的卡片**，点进去才带上语境；
// 顶栏只留一个胶囊显示当前在哪儿，点它回来重选。
//
// 卡片上放的东西按「进去之前想知道什么」选：这个项目有多少活、卡没卡、
// 仓在哪、就不就绪。光有名字的卡片等于把下拉换了个样子。

function 项目胶囊() {
  const 钮 = $('项目钮');
  if (!钮) return;
  const v = 取选中项目();
  const p = 项目表.find((x) => x.名 === v);
  if (!v) { 钮.textContent = '全部项目'; 钮.className = '项目钮 全'; 钮.title = '点击选一个项目'; return; }
  if (v === '(无项目)') { 钮.textContent = '（无项目）'; 钮.className = '项目钮 全'; 钮.title = '只看不带项目的单'; return; }
  钮.textContent = v;
  // 不就绪的项目在胶囊上就要看得出来，不能等人点进去建单才发现
  钮.className = '项目钮' + (p && !p.就绪 ? ' 坏' : '');
  钮.title = p ? p.说 : '点击切换项目';
}

async function 刷项目页() {
  const 容 = $('项目卡');
  if (!容) return;
  await 刷项目();
  const 当前 = 取选中项目();
  // 每个项目的活有多少——要现算。卡片上只写名字的话，
  // 人还是得进去一个个看，那跟下拉没区别。
  let 计 = {};
  try {
    const { 体: j } = await 取JSON('/api/tickets');
    for (const t of (j.工单 || [])) {
      const k = (t.fm && t.fm.项目) || '(无项目)';
      const c = 计[k] || (计[k] = { 待投: 0, 在途: 0, 质检: 0, 完成: 0, 总: 0 });
      c.总 += 1;
      if (c[t.state] !== undefined) c[t.state] += 1;
    }
  } catch { /* 工单库没配好时卡片照出，只是没有数字 */ }

  // 「全部项目」不是一个真项目名，按名字去取计数只会拿到空对象——
  // 第一版就是这样，那张卡上四个数全是 0，而它本该是最大的那组。
  计['全部项目'] = Object.values(计).reduce((a, c) => ({
    待投: a.待投 + c.待投, 在途: a.在途 + c.在途, 质检: a.质检 + c.质检, 完成: a.完成 + c.完成, 总: a.总 + c.总,
  }), { 待投: 0, 在途: 0, 质检: 0, 完成: 0, 总: 0 });

  const 卡 = (名, 项, 无项目) => {
    const c = 计[名] || {};
    const 选中 = 名 === 当前;
    const 数 = [['待投', c.待投 || 0], ['在途', c.在途 || 0], ['质检', c.质检 || 0], ['完成', c.完成 || 0]];
    return '<div class="项目卡' + (选中 ? ' 在' : '') + (项 && !项.就绪 ? ' 坏' : '') + '"'
      + ' tabindex="0" role="button" aria-label="进入 ' + 转义(名) + '"'
      + ' onclick="进项目(\'' + 转义(名) + '\')"'
      + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();进项目(\'' + 转义(名) + '\')}">'
      + '<div class="卡头"><b>' + 转义(名) + '</b>'
      + (项 && 项.默认 ? '<span class="pill mut">默认</span>' : '')
      + (选中 ? '<span class="pill ok">当前</span>' : '')
      + (项 && !项.就绪 ? '<span class="pill red">不可用</span>' : '')
      + '</div>'
      + (无项目
        ? '<div class="卡注">不带项目的单：只跑不提交，不走 worktree 也不合并。</div>'
        : '<div class="卡路 mono" title="' + 转义((项 && 项.路径) || '') + '">' + 转义((项 && 项.路径) || '') + '</div>')
      + (项 && !项.就绪 ? '<div class="卡注 级急">' + 转义(项.说) + '</div>' : '')
      + '<div class="卡数">' + 数.map(([l, v]) =>
        '<span class="卡计"><i' + (v ? '' : ' class="零"') + '>' + v + '</i>' + l + '</span>').join('') + '</div>'
      + '</div>';
  };

  容.innerHTML =
    卡('全部项目', { 路径: '不筛选，看板显示全部工单', 就绪: true }, false).replace('class="卡路 mono"', 'class="卡注"')
    + 项目表.map((p) => 卡(p.名, p)).join('')
    + 卡('(无项目)', null, true)
    + '<div class="项目卡 加" tabindex="0" role="button" onclick="开登记项目()"'
    + ' onkeydown="if(event.key===\'Enter\'){开登记项目()}">'
    + '<div class="加号">＋</div><div>登记项目</div>'
    + '<div class="卡注">登记 = 允许 AI 往这个仓提交</div></div>';
}

// 进一个项目：设好语境就回驾驶舱。停在项目页上让人自己点「驾驶舱」是多一步。
function 进项目(名) {
  存选中项目(名 === '全部项目' ? '' : 名);
  项目胶囊();
  location.hash = '#/';
}



// ══════════════════════════════════════════════════════════════
// 开机（必须是本文件的最后一段）
// ══════════════════════════════════════════════════════════════
// 位置是硬要求，不是风格：上面用到的模块级常量（项目表、项目参…）都是 const/let，
// 不会像函数声明那样提升。开机段放在它们**前面**的话，调用时撞暂时性死区，
// 抛 ReferenceError，而各个刷新函数自己的 catch 会把它吞成「接口不可达」——
// 接口好好的，人却会去查服务端、端口、门禁，全都对。协-007 实测踩了两次。
(async () => {
  // 项目表要先到：看板与流程的取数都带项目参数，晚一步会先按「全部」渲一遍再重渲。
  await 刷项目();
  // 刷计费要在刷工单之前：按钮的字与颜色靠计费表决定，晚一步会先渲一遍
  // 「计费未声明」再重渲，而那四个字正是这次要消灭的东西。
  await 刷计费();
  刷健康(); 刷工单(); 刷调度(); 刷排名(); 刷战绩(); 刷消耗(); 刷providers(); 刷瞭望塔();
  切页();
})();
