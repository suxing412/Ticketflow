// config.test.js — 配置加载：BOM 容忍（0.8.1 套件 E2E 事故回归）+ 根定位
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../lib/core/config');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('config 配置加载测试');

t('带 UTF-8 BOM 的配置可解析（PowerShell 5.1 / 记事本产物）', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(d, 'studio.config.json'), '﻿' + JSON.stringify({ server: { port: 1 } }), 'utf8');
  assert.equal(config.load(d).server.port, 1);
});

t('无 BOM 照常解析', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(d, 'studio.config.json'), JSON.stringify({ server: { port: 2 } }), 'utf8');
  assert.equal(config.load(d).server.port, 2);
});

t('resolveRoot：从子目录向上找到含配置的根', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(d, 'studio.config.json'), '{}', 'utf8');
  const sub = path.join(d, 'a', 'b'); fs.mkdirSync(sub, { recursive: true });
  assert.equal(config.resolveRoot(sub), d);
});

t('resolveRoot：裸 EXE 构建目录可回退到默认开发运行目录', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-home-'));
  const studio = path.join(d, 'AIStudioDev'); fs.mkdirSync(studio);
  fs.writeFileSync(path.join(studio, 'studio.config.json'), '{}', 'utf8');
  const oldStudio = process.env.STUDIO_ROOT;
  const oldUser = process.env.USERPROFILE;
  const oldLocal = process.env.LOCALAPPDATA;
  delete process.env.STUDIO_ROOT;
  process.env.USERPROFILE = d;
  process.env.LOCALAPPDATA = path.join(d, 'missing-local');
  try {
    assert.equal(config.resolveRoot(path.join(d, 'unrelated', 'dist')), studio);
  } finally {
    if (oldStudio === undefined) delete process.env.STUDIO_ROOT; else process.env.STUDIO_ROOT = oldStudio;
    if (oldUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldUser;
    if (oldLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocal;
  }
});

t('V2 通用模板是合法 JSON，包含角色、Provider 与自动路由', () => {
  const file = path.resolve(__dirname, '..', '..', '套件', 'studio.config.template.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.schemaVersion, 2);
  assert.ok(cfg.roles.orchestrator && cfg.roles.backend && cfg.roles.frontend);
  assert.ok(cfg.providers.codex && cfg.providers.claude && cfg.providers.kimi);
  assert.equal(cfg.agents.every((agent) => agent.routing.mode === 'auto'), true);
  assert.equal(cfg.workspace.mode, 'worktree');
  assert.equal(cfg.workspace.autoCommit, true);
  assert.equal(cfg.orchestration.allowNested, false);
});

t('分发默认值不绑定盘符、用户名或本地代理端口', () => {
  const repo = path.resolve(__dirname, '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, '_app', 'package.json'), 'utf8'));
  const pnpm = fs.readFileSync(path.join(repo, '_app', 'pnpm-workspace.yaml'), 'utf8');
  const template = JSON.parse(fs.readFileSync(path.join(repo, '套件', 'studio.config.template.json'), 'utf8'));
  const launcher = fs.readFileSync(path.join(repo, '一键启动监制台.bat'), 'utf8');
  assert.equal(path.isAbsolute(pkg.build.directories.output), false, '构建输出应相对项目目录');
  assert.equal(path.isAbsolute(pkg.build.electronDist), false, 'Electron 分发目录应相对项目目录');
  assert.match(pnpm, /nodeLinker:\s*hoisted/, 'pnpm 必须使用 Electron Builder 可封装的提升式布局');
  assert.match(pnpm, /allowBuilds:\s*[\s\S]*electron:\s*true/, 'pnpm 必须允许 Electron 安装运行时');
  assert.equal(template.网络.代理默认, '', '新安装默认直连/VPN，不假设本地代理');
  assert.ok(!/C:\\Users\\|C:\/Users\//i.test(launcher), '启动器不得写死用户名路径');
});

console.log(`全部通过：${passed} 项`);
