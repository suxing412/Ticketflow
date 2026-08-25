// eventarchive.js — CLI 原始事件流按单存档与双闸清理。
//
// 只接 runner 已经消费到的 stream-json stdout：这里不创建第二个 reader，也不参与
// 分拣、计量或收线裁决。存档出错永远只记流水，不向 runner 抛异常。
const fs = require('fs');
const path = require('path');
const journal = require('./journal');
const config = require('./core/config');

const 换行 = Buffer.from('\n');
const JSONL后缀 = '.jsonl';
const 未分配目录 = '_unassigned';
const 一天毫秒 = 24 * 60 * 60 * 1000;
const 默认配置 = config.事件流存档默认;

function 默认值() { return { ...默认配置 }; }

// 旧配置缺此段时回落默认；这个函数不写盘，配置迁移由 core/config 统一负责。
function 参数(cfg, root) {
  const raw = (cfg && cfg.事件流存档 && typeof cfg.事件流存档 === 'object') ? cfg.事件流存档 : {};
  const 数 = (key) => Number.isFinite(Number(raw[key])) && Number(raw[key]) >= 0 ? Number(raw[key]) : 默认配置[key];
  const 根配置 = typeof raw.根路径 === 'string' && raw.根路径.trim() ? raw.根路径.trim() : 默认配置.根路径;
  return {
    开: raw.开 !== false,
    根路径: path.isAbsolute(根配置) ? path.normalize(根配置) : path.resolve(root, 根配置),
    保留天数: 数('保留天数'),
    总体积上限字节: 数('总体积上限字节'),
  };
}

// 仅移除 Windows 路径非法字符；正常单号/runId 保持原样，避免路径穿越或跨目录写入。
function 路径段(v, 缺省) {
  const s = String(v == null ? '' : v).trim();
  return (s || 缺省).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

function 文件路径(root, cfg, 单号, runId) {
  const p = 参数(cfg, root);
  return path.join(p.根路径, 路径段(单号, 未分配目录), 路径段(runId, 'unknown') + JSONL后缀);
}

function 记(root, text) {
  try { journal.append(root, text); } catch { /* 留痕失败也不影响执行器 */ }
}

function 收集文件(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) 收集文件(p, out);
    else if (entry.isFile() && entry.name.endsWith(JSONL后缀)) {
      try {
        const st = fs.statSync(p);
        out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* 文件在枚举后被别的清理器删掉，下一项照常 */ }
    }
  }
  return out;
}

function 回收空目录(dir, 根) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) if (entry.isDirectory()) 回收空目录(path.join(dir, entry.name), 根);
  if (path.resolve(dir) === path.resolve(根)) return;
  try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch { /* 并发新写入时保留目录 */ }
}

// 两闸取并集：过期文件先删；如果总量仍超限，继续按 mtime 最老删。
// activeFiles 必须是绝对路径集合，正在写的 run 无论多旧都不碰。
function 清理(root, cfg, opts = {}) {
  const p = 参数(cfg, root);
  if (!p.开) return { 开: false, 删除文件数: 0, 释放字节数: 0, 触发闸: '无' };
  const now = opts.now == null ? Date.now() : Number(opts.now);
  const 活跃 = new Set([...(opts.activeFiles || [])].map((f) => path.resolve(f)));
  let 删除文件数 = 0;
  let 释放字节数 = 0;
  let 天数触发 = false;
  let 体积触发 = false;
  try {
    const files = 收集文件(p.根路径).sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
    const cutoff = now - p.保留天数 * 一天毫秒;
    let remaining = files.reduce((sum, file) => sum + file.size, 0);
    const 删除 = (file) => {
      if (活跃.has(path.resolve(file.path))) return false;
      try {
        fs.unlinkSync(file.path);
        remaining -= file.size;
        删除文件数++;
        释放字节数 += file.size;
        return true;
      } catch { return false; }
    };

    for (const file of files) {
      if (file.mtimeMs < cutoff) {
        天数触发 = true;
        删除(file);
      }
    }
    if (remaining > p.总体积上限字节) {
      体积触发 = true;
      for (const file of files) {
        if (remaining <= p.总体积上限字节) break;
        删除(file);
      }
    }
    回收空目录(p.根路径, p.根路径);
    const 触发闸 = 天数触发 && 体积触发 ? '双闸' : (天数触发 ? '天数' : (体积触发 ? '体积' : '无'));
    记(root, `事件流存档清理：删除 ${删除文件数} 文件 · 释放 ${释放字节数} 字节 · 触发闸=${触发闸}`);
    return { 开: true, 删除文件数, 释放字节数, 触发闸 };
  } catch (e) {
    const why = String((e && e.message) || e).slice(0, 120);
    记(root, `事件流存档清理告警：${why}——不阻断 runner`);
    return { 开: true, 删除文件数, 释放字节数, 触发闸: '异常', error: why };
  }
}

// 逐行写入：不完整尾段只留在内存；进程断连时盘上每一行仍是完整的原始行。
function 打开(root, cfg, opts = {}) {
  const p = 参数(cfg, root);
  if (!p.开) return null;
  const 单号 = 路径段(opts.单号, 未分配目录);
  const runId = 路径段(opts.runId, 'unknown');
  const file = path.join(p.根路径, 单号, runId + JSONL后缀);
  let fd = null;
  let 尾段 = Buffer.alloc(0);
  let 关闭 = false;
  let 已告警 = false;
  const 告警 = (e) => {
    if (已告警) return;
    已告警 = true;
    const why = String((e && e.message) || e).slice(0, 120);
    记(root, `事件流存档告警 ${opts.单号 || 未分配目录}（${runId}）：${why}——不阻断 runner`);
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fd = fs.openSync(file, 'a');
  } catch (e) {
    告警(e);
    return null;
  }

  const 写 = (chunk) => {
    if (关闭 || fd == null) return;
    try {
      const merged = 尾段.length ? Buffer.concat([尾段, Buffer.from(chunk)]) : Buffer.from(chunk);
      let offset = 0;
      for (;;) {
        const end = merged.indexOf(换行, offset);
        if (end < 0) break;
        fs.writeSync(fd, merged.subarray(offset, end + 换行.length));
        offset = end + 换行.length;
      }
      尾段 = Buffer.from(merged.subarray(offset));
    } catch (e) {
      告警(e);
      try { fs.closeSync(fd); } catch { /* 尽力关闭 */ }
      fd = null;
    }
  };

  const 收尾 = () => {
    if (关闭) return;
    关闭 = true;
    // 正常 CLI 偶尔以不带换行的最后一条 JSON 收线，仍要原样保留；截断半行 parse 不过，
    // 则不落盘，保证进程异常退出后已落盘的每一行依旧可解析。
    if (fd != null && 尾段.length) {
      try { JSON.parse(尾段.toString('utf8')); fs.writeSync(fd, 尾段); }
      catch { /* 断连截尾：丢弃仅存在内存的半行 */ }
    }
    尾段 = Buffer.alloc(0);
    try { if (fd != null) fs.closeSync(fd); } catch (e) { 告警(e); }
    fd = null;
    清理(root, cfg, { activeFiles: [file] });
  };
  return { 路径: file, 写, 收尾 };
}

module.exports = { 默认值, 参数, 文件路径, 打开, 清理, 未分配目录 };
