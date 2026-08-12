// 计费契约测试 —— 分清「用订阅额度」和「按 token 付费」（协-008）。
//
// 这一组守的全是**方向性**：判错的两个方向代价完全不对称。
//   · 把计费误判成订阅 → 人在不知情的情况下被按 token 计费，账单出来才发现
//   · 把订阅误判成计费 → 多问一句，烦但无害
// 所以每一处不确定都必须倒向后者。测试要盯住的正是这个倾斜。
'use strict';
const assert = require('node:assert');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 计费 = require(path.join(平台根, 'lib', '计费.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('计费契约测试');

const 配 = (表) => ({ 计费: 表 });
const 订阅配 = 配({ claude: { 模式: '订阅', 订阅名: 'Claude Pro' } });
const 计费配 = 配({ gpt: { 模式: 'api' } });

t('未声明的池一律按「会计费」对待（不猜——猜错的方向是让人被静默计费）', () => {
  assert.equal(计费.模式({}, 'claude'), 计费.未声明);
  assert.equal(计费.会新增开销({}, 'claude'), true, '未声明必须当成会花钱');
  const 说 = 计费.说明({}, 'claude');
  assert.equal(说.花钱, true);
  assert.ok(/不猜/.test(说.说), '要讲清为什么不猜：' + 说.说);
  // 空配置、null、缺 计费 段，都走同一条路——别在这类边角上留个「恰好当成订阅」的洞
  for (const c of [null, undefined, {}, { 计费: null }, { 计费: {} }]) {
    assert.equal(计费.会新增开销(c, 'x'), true);
  }
});

t('订阅池：这一次不产生新开销，标签也不该写「花钱」', () => {
  // 这条是整轮改动的由来：走 Claude Pro 时月费已经付了，边际成本是零。
  // 把它标成花钱，人会不敢走本来就该走的主路径。
  assert.equal(计费.模式(订阅配, 'claude'), 计费.订阅);
  assert.equal(计费.会新增开销(订阅配, 'claude'), false);
  const 说 = 计费.说明(订阅配, 'claude');
  assert.equal(说.花钱, false);
  assert.ok(说.标签.includes('订阅'), 说.标签);
  assert.ok(/Claude Pro/.test(说.说) && /不产生新开销/.test(说.说), 说.说);
});

t('订阅耗尽之后，同一个池立刻变成「会花钱」', () => {
  // 耗尽是这套口径里唯一的转折点：在它之前不花钱，在它之后每一次都花。
  assert.equal(计费.会新增开销(订阅配, 'claude', { 订阅已耗尽: true }), true);
  const 说 = 计费.说明(订阅配, 'claude', { 订阅已耗尽: true });
  assert.equal(说.花钱, true);
  assert.ok(/API|计费/.test(说.说), '要说清再跑会落到按 token 计费：' + 说.说);
});

t('声明为 api 的池，任何时候都算花钱', () => {
  assert.equal(计费.模式(计费配, 'gpt'), 计费.计费);
  assert.equal(计费.会新增开销(计费配, 'gpt'), true);
  assert.equal(计费.会新增开销(计费配, 'gpt', { 订阅已耗尽: false }), true);
});

t('模式写法宽松：订阅/subscription/sub、api/计费/metered 都认', () => {
  // 配置是人手写的，为一个大小写或同义词让整台机器倒向「按会计费处理」，
  // 表现是每次都多弹一个确认框——不致命，但会让人开始无视那个框。
  for (const v of ['订阅', 'subscription', 'sub', 'SUB', ' 订阅 ']) {
    assert.equal(计费.模式(配({ p: { 模式: v } }), 'p'), 计费.订阅, v);
  }
  for (const v of ['api', 'API', '计费', 'metered']) {
    assert.equal(计费.模式(配({ p: { 模式: v } }), 'p'), 计费.计费, v);
  }
  // 本地：command-cli 这类跑本机命令的池，根本不存在厂商计费。
  // 少这一档的后果实测过：echo 桩池落进「未声明」＝按会花钱算，
  // 于是一个永远不花钱的池把整个看板拖成红的，红色就此失去意义。
  for (const v of ['本地', 'local', '免费', 'free']) {
    assert.equal(计费.模式(配({ p: { 模式: v } }), 'p'), 计费.本地, v);
  }
  assert.equal(计费.会新增开销(配({ p: { 模式: '本地' } }), 'p'), false);
  assert.equal(计费.说明(配({ p: { 模式: '本地' } }), 'p').花钱, false);

  // 认不出来的写法**不许猜**，落回未声明（= 按会计费处理）
  for (const v of ['订', 'freeee', '', null, 123]) {
    assert.equal(计费.模式(配({ p: { 模式: v } }), 'p'), 计费.未声明, String(v));
  }
});

// ---- 耗尽判定 ----
t('stdout 里的散文不算数：agent 谈论限流 ≠ 它自己撞上限流', () => {
  // 这条踩了两次才写对。第一版拿尾部 2000 字去匹配，被 agent 正文里反复讨论
  // 「给接口加上 rate limit 保护」骗到；改成只看最后三行，照样骗到——那句就是最后一行。
  // 问题不在取多少字，在于 stdout 装的是 agent 的话。
  // 误判的代价实打实：平台以为额度没了、停派、弹框问人，而额度好好的。
  const 长正文 = '我建议给接口加上 rate limit 保护。\n'.repeat(200);
  assert.equal(计费.判耗尽(订阅配, 'claude', { 输出: 长正文, 错出: '', 退出码: 1 }), null,
    'agent 讨论限流被当成了额度耗尽');
  // 同样一句话，只要不带错误标记，加多少遍都不算
  assert.equal(计费.判耗尽(订阅配, 'claude', { 输出: 长正文 + '\n还要注意 usage limit 的边界', 退出码: 1 }), null);

  // stderr 是权威通道：限流是 CLI 自己报的错，全篇都查
  assert.ok(计费.判耗尽(订阅配, 'claude', { 输出: '', 错出: 'Error: quota exceeded', 退出码: 1 }));
  // stdout 要**同时**带错误标记才定案（claude 的 stream-json 会吐 type:"error"）
  assert.ok(计费.判耗尽(订阅配, 'claude', {
    输出: 长正文 + '\n{"type":"error","message":"usage limit reached"}', 退出码: 1,
  }), 'stdout 上带错误标记的限流事件应当认出来');
});

t('跑成功了就不是耗尽（退出码 0 一律不判）', () => {
  // 少了这一条，一次成功运行只要正文里出现「额度不足」四个字就会把池标成耗尽。
  assert.equal(计费.判耗尽(订阅配, 'claude', { 输出: 'usage limit', 错出: 'rate limit', 退出码: 0 }), null);
});

t('耗尽信号可在配置里覆盖，不必改源码', () => {
  // 各家 CLI 的限流措辞会变，而这些模式是尽力而为的、没在真实耗尽现场验证过。
  // 留一个不改源码的出口，比把它们钉死在代码里诚实。
  const c = 配({ p: { 模式: '订阅', 耗尽信号: ['你今天的额度没了'] } });
  assert.ok(计费.判耗尽(c, 'p', { 错出: '你今天的额度没了', 退出码: 1 }));
  assert.equal(计费.判耗尽(c, 'p', { 错出: 'usage limit reached', 退出码: 1 }), null,
    '给了自定义清单就只认自定义的——半新半旧会让人搞不清到底哪些生效');
  // 坏正则不能把整个判定打挂
  const 坏 = 配({ p: { 模式: '订阅', 耗尽信号: ['(('] } });
  assert.doesNotThrow(() => 计费.判耗尽(坏, 'p', { 错出: 'x', 退出码: 1 }));
});

// ---- 静默计费风险 ----
t('订阅池 + 环境里有 API key = 可能被静默计费，必须提前讲', () => {
  // 这是最要紧的一条，且**与字符串匹配无关**：CLI 在订阅额度耗尽后，
  // 若发现环境变量里有 API key，可能自己切到按 token 计费——平台看不见那次切换，
  // 人也收不到任何提示，直到账单出来。
  const 险 = 计费.落计费风险(订阅配, 'claude', { ANTHROPIC_API_KEY: 'sk-xxx' });
  assert.ok(险, '带着 API key 却没报风险');
  assert.deepEqual(险.变量, ['ANTHROPIC_API_KEY']);
  assert.ok(/账单/.test(险.说), '要说清后果落在哪：' + 险.说);
  // 没有 key 就没有这个风险——不该天天报一句用不上的警告，那会让人学会无视
  assert.equal(计费.落计费风险(订阅配, 'claude', {}), null);
  assert.equal(计费.落计费风险(订阅配, 'claude', { ANTHROPIC_API_KEY: '   ' }), null, '空白值不算设了');
  // api 模式本来就在计费，不存在「静默切换」这回事
  assert.equal(计费.落计费风险(计费配, 'gpt', { OPENAI_API_KEY: 'sk-x' }), null);
});

t('耗尽后策略：默认是「问」', () => {
  // 用户的设计原话就是这个：用完了再问要不要用 API 计费。
  // 默认值写错的后果不对称——默认成「用api」等于把那句话跳过去了。
  assert.equal(计费.耗尽后({}, 'p'), '问');
  assert.equal(计费.耗尽后(配({ p: { 耗尽后: '停' } }), 'p'), '停');
  assert.equal(计费.耗尽后(配({ p: { 耗尽后: '用api' } }), 'p'), '用api');
  assert.equal(计费.耗尽后(配({ p: { 耗尽后: '随便写' } }), 'p'), '问', '认不出的值要落回最保守的那个');
});

// ---- 界面口径 ----
t('界面不再对订阅池说「花钱」，但对计费池必须说', () => {
  const 脚本 = require('fs').readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  // 按钮文案必须由计费状态决定，不能再写死
  assert.ok(!/真跑（花钱）/.test(脚本), 'app.js 里还有写死的「真跑（花钱）」——走订阅额度时那是不实的');
  assert.ok(!/真判（花钱）/.test(脚本), 'app.js 里还有写死的「真判（花钱）」');
  assert.ok(/真跑标签/.test(脚本) && /真跑钮类/.test(脚本), '按钮的字与颜色要跟着计费模式走');

  // 钉**行为**不钉写法。第一版这里断言的是一行源码长什么样
  // （`会花钱(池) ? 'btn danger-o' : 'btn'`），改一次实现就红一次，
  // 而被测的东西一点没坏——那种断言只会训练人去改测试。
  // 把两个函数抠出来在 node 里真的跑一遍，行为对不对一目了然。
  const 抠 = (名) => {
    const m = new RegExp(`(?:function ${名}[\\s\\S]*?\\n\\}|const ${名} = [^;]+;)`).exec(脚本);
    assert.ok(m, `app.js 里找不到 ${名}`);
    return m[0];
  };
  const 沙盒 = new Function('表',
    抠('真跑标签') + '\n' + 抠('整体会花钱') + '\n'
    + 'const 计费表 = 表;\n'
    + 'const 会花钱 = (池) => { const c = 计费表[池]; return c ? !!c.花钱 : true; };\n'
    + 抠('真跑钮类') + '\n'
    + 'return { 真跑标签, 真跑钮类 };');

  const 订阅表 = { claude: { 模式: '订阅', 花钱: false }, codex: { 模式: '订阅', 花钱: false } };
  const g1 = 沙盒(订阅表);
  assert.equal(g1.真跑钮类('claude'), 'btn', '订阅池不该标红');
  assert.ok(!/花钱|计费/.test(g1.真跑标签('claude', '真跑')), '订阅池的按钮不该出现「花钱/计费」：' + g1.真跑标签('claude', '真跑'));
  // 待投单还没有池，全屏标红等于没有信号
  assert.equal(g1.真跑钮类(''), 'btn', '全是订阅池时，池未知也不该标红');
  assert.equal(g1.真跑标签('', '真跑'), '真跑', '池未知时不许瞎猜计费模式');

  const 耗尽表 = { claude: { 模式: '订阅', 花钱: true, 已耗尽: true } };
  const g2 = 沙盒(耗尽表);
  assert.equal(g2.真跑钮类('claude'), 'btn danger-o', '额度耗尽后必须标红——这才是真要花钱的时候');
  assert.ok(/计费/.test(g2.真跑标签('claude', '真跑')), g2.真跑标签('claude', '真跑'));
  assert.equal(g2.真跑钮类(''), 'btn danger-o', '有池会花钱时，池未知也要标红');
});

t('出厂配置不预设任何池的计费模式', () => {
  // 订阅是账号级事实，跟机器走。出厂预设等于替用户声明了一件平台无从知道的事，
  // 而这个方向的错会让人被静默计费。
  const 出厂 = require(path.join(平台根, 'config', 'platform.config.json'));
  assert.deepEqual(出厂.计费 || {}, {}, '出厂配置里不该预设计费模式');
  assert.ok(Array.isArray(出厂._计费说明) && 出厂._计费说明.length,
    '出厂配置要留一段说明，否则人不知道这个空对象是什么意思');
});

console.log(`全部通过：${passed} 项`);
