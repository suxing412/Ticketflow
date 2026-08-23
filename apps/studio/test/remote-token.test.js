// remote-token.test.js — 远程访问令牌不落版本控制（2026-08-21 体检）
// 案源：令牌明文写在 监制台/studio.config.json 的 网络.远程.令牌，而该文件**被 git 跟踪**，
// 已随 97 次自动记账推进远端仓。该仓私有、远程监听关着，故是隐患不是失火——
// 但令牌一旦进过历史就该当已泄漏处理，哪天把 远程.开 打成 true 就是拿一个公开过的口令把门。
// 同一份 .gitignore 第 4 行早就排除了 监制台/凭据.json——「密钥不进库」是既定纪律，只有这条漏网。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('远程令牌测试');
const 根 = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(根, 'server.js'), 'utf8');

t('令牌取值走三候选：环境变量 > 凭据档 > 配置（配置只作兼容回落）', () => {
  assert.match(src, /function 远程令牌\(\)/, '要有唯一取值口，不许各处各读各的');
  const 体 = src.slice(src.indexOf('function 远程令牌()'), src.indexOf('function 远程令牌()') + 700);
  assert.match(体, /STUDIO_REMOTE_TOKEN/, '环境变量优先');
  assert.match(体, /creds'\)\.read|creds\.read/, '其次凭据档（.gitignore 已排除）');
  assert.match(体, /REMOTE\(\)\.令牌/, '最后才回落配置，老部署不砸');
});

t('鉴权与开关都走那个唯一取值口，不许再直读 REMOTE().令牌', () => {
  const 鉴 = src.slice(src.indexOf('const tokenOk'), src.indexOf('const tokenOk') + 300);
  assert.match(鉴, /远程令牌\(\)/, '鉴权读的必须是三候选合并后的值');
  assert.ok(!/const tk = REMOTE\(\)\.令牌/.test(src), '不许回到直读配置');
});

t('硬约束：没令牌就不许开远程（人手把令牌删空时，开关还是 true，门就是敞的）', () => {
  assert.match(src, /const remoteOn = !!REMOTE\(\)\.开 && !!远程令牌\(\)/,
    '开 && 有令牌 —— 两个条件缺一不可');
});

t('重生成的令牌落凭据档，不写回配置；且只在刚生成时回显一次', () => {
  const 段 = src.slice(src.indexOf("app.post('/api/config/remote'"), src.indexOf("app.post('/api/config/remote'") + 1600);
  assert.match(段, /cur\.远程令牌 = 新令牌/, '新值落凭据档');
  assert.match(段, /cfg\.网络\.远程\.令牌 = ''/, '配置里只留空位');
  assert.ok(!/令牌: cfg\.网络\.远程\.令牌/.test(段), '不许回显配置里的令牌——回显等于给每个能开参数页的东西一份口令');
  assert.match(段, /\.\.\.\(新令牌 \? \{ 令牌: 新令牌 \} : \{\}\)/, '只在刚生成时回一次（人得拿到它）');
});

t('活体判据：被跟踪的配置文件里没有 32 位 hex 令牌', () => {
  const 仓 = 'D:/GitHub/AI-GameStudio';
  if (!fs.existsSync(path.join(仓, '.git'))) { console.log('    （无该仓，跳过活体判据）'); return; }
  const 文 = fs.readFileSync(path.join(仓, '监制台', 'studio.config.json'), 'utf8');
  const c = JSON.parse(文);
  const tk = (((c.网络 || {}).远程) || {}).令牌 || '';
  assert.equal(tk, '', '配置里的令牌必须为空，值在凭据档：实测 ' + JSON.stringify(tk).slice(0, 20));
  assert.ok(!/"[0-9a-f]{32}"/.test(文), '整份配置里不许再出现 32 位 hex 串');
  const 忽略 = execFileSync('git', ['-C', 仓, 'check-ignore', '监制台/凭据.json'], { encoding: 'utf8' }).trim();
  assert.ok(忽略, '凭据档必须仍在 .gitignore 里');
});

console.log('全部通过：' + passed + ' 项');
