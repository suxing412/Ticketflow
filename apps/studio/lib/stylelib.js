// stylelib.js — 风格库（D12 精选制）：入库/出库的唯一通道，审批点④的落地。
// 策划标杆 = 明文 md（唯一事实源，条目约定：## 标题 + 正文 + ——来源 单号 · 日期）；
// 美术库 = 文件 + 旁存 .meta.json 来源记录。唯一写者 = 制作人层（D20）。
const fs = require('fs');
const path = require('path');

const axPath = (root) => path.join(root, '风格库', '策划标杆.md');
const artDir = (root) => path.join(root, '风格库', '美术库');
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

// 解析标杆条目（头部 # 行保留原样，不属于条目）。
// 多项目视界（v0.12）：来源落款可带第三段「· 项目名」；旧条目无项目段 = 归默认项目
function parseAxioms(root) {
  let raw = '';
  try { raw = fs.readFileSync(axPath(root), 'utf8'); } catch { return []; }
  const entries = [];
  const parts = raw.split(/^## /m).slice(1);
  for (const p of parts) {
    const lines = p.split('\n');
    const 标题 = lines[0].trim();
    const bodyLines = []; let 源单 = null; let 日期 = null; let 项目 = null;
    for (const l of lines.slice(1)) {
      const m = l.match(/^——来源\s+(\S+)\s+·\s+(\d{4}-\d{2}-\d{2})(?:\s+·\s+(\S+))?/);
      if (m) { 源单 = m[1]; 日期 = m[2]; 项目 = m[3] || null; continue; }
      if (l.trim()) bodyLines.push(l.trim());
    }
    if (标题) entries.push({ 标题, 正文: bodyLines.join(' '), 源单, 日期, 项目 });
  }
  return entries;
}

function addAxiom(root, { 标题, 正文, 源单, 项目 }) {
  const t = String(标题 || '').trim(), b = String(正文 || '').trim();
  if (!t || !b) return { ok: false, error: '标题与提炼正文都不能为空' };
  if (t.length > 40 || b.length > 300) return { ok: false, error: '标题 ≤40 字、正文 ≤300 字（标杆要精炼）' };
  if (parseAxioms(root).some((e) => e.标题 === t)) return { ok: false, error: '同名条目已在标杆：' + t };
  const date = new Date().toISOString().slice(0, 10);
  const block = `\n## ${t}\n${b}\n\n——来源 ${源单 || '手工'} · ${date}${项目 ? ` · ${项目}` : ''}\n`;
  if (!fs.existsSync(axPath(root))) fs.writeFileSync(axPath(root), '# 策划标杆（提炼式设计公理）\n', 'utf8');
  fs.appendFileSync(axPath(root), block, 'utf8');
  return { ok: true, 标题: t };
}

// 移出标杆：按标题切除该 section（行级切片，不重写其余内容——md 可能有手工编辑）
function removeAxiom(root, 标题) {
  let raw;
  try { raw = fs.readFileSync(axPath(root), 'utf8'); } catch { return { ok: false, error: '标杆文件不存在' }; }
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## ' + String(标题).trim());
  if (start < 0) return { ok: false, error: '条目不存在：' + 标题 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  const out = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(axPath(root), out, 'utf8');
  return { ok: true };
}

function listArt(root) {
  const dir = artDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.endsWith('.meta.json')).map((name) => {
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, name + '.meta.json'), 'utf8')); } catch { /* 无来源记录 */ }
    return { name, ext: path.extname(name).toLowerCase(), isImage: IMG_EXT.includes(path.extname(name).toLowerCase()), 来源: meta };
  });
}

// 入美术库：从项目仓库复制产出文件（源路径限制在项目仓库内，防任意读取）。
// 项目 名字随 meta 旁存——多项目视界按它归属；旧条目无此字段 = 归默认项目
function addArt(root, { 源路径, 项目路径, 说明, 源单, 项目 }) {
  const raw = String(源路径 || '').trim();
  if (!raw) return { ok: false, error: '源文件路径不能为空' };
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(项目路径 || '', raw));
  if (项目路径 && !abs.toLowerCase().startsWith(path.normalize(项目路径).toLowerCase()))
    return { ok: false, error: '源文件必须在项目仓库内：' + 项目路径 };
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, error: '源文件不存在：' + abs.slice(-60) };
  if (fs.statSync(abs).size > 50 * 1024 * 1024) return { ok: false, error: '文件超 50MB，不入库' };
  fs.mkdirSync(artDir(root), { recursive: true });
  let dest = path.basename(abs);
  if (fs.existsSync(path.join(artDir(root), dest))) dest = `${源单 || 'dup'}_${dest}`; // 撞名带单号前缀
  fs.copyFileSync(abs, path.join(artDir(root), dest));
  fs.writeFileSync(path.join(artDir(root), dest + '.meta.json'),
    JSON.stringify({ 源单: 源单 || null, 项目: 项目 || null, 源路径: abs.replace(/\\/g, '/'), 说明: String(说明 || '').slice(0, 100), 日期: new Date().toISOString().slice(0, 10) }, null, 2), 'utf8');
  return { ok: true, name: dest };
}

function removeArt(root, name) {
  const n = String(name || '');
  if (!n || n.includes('/') || n.includes('\\') || n.includes('..')) return { ok: false, error: '非法文件名' };
  const f = path.join(artDir(root), n);
  if (!fs.existsSync(f)) return { ok: false, error: '文件不存在：' + n };
  fs.unlinkSync(f);
  try { fs.unlinkSync(f + '.meta.json'); } catch { /* 无旁存 */ }
  return { ok: true };
}

module.exports = { parseAxioms, addAxiom, removeAxiom, listArt, addArt, removeArt };
