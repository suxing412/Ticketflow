// 轮转 —— 只增不减的 jsonl 得有个尽头（协-019）。
//
// 无人值守的代价之一是流水会一直长。`journal/provider-runs.jsonl` 现在 90KB 且只增，
// 呼叫信箱会是第二个。长到几百 MB 之后，读它的每一处（战绩报表、按单花费、未读统计）
// 都会先把整份读进内存——那时候坏的不是磁盘，是接口开始变慢然后 OOM。
//
// 策略最笨的那种，也是最不会自己坏的那种：**按大小切分 + 保留 N 份**。
//   provider-runs.jsonl → provider-runs.1.jsonl → …N，越大的编号越老，超出的删掉。
// 不做压缩（要引依赖）、不做按天切（跨天的边界判断在时区上会咬人）、不做后台线程。
//
// 调用点：写之前问一句「该转了吗」。转的动作是 rename，毫秒级；转完原文件不存在，
// 调用方照常 appendFileSync 会自动新建——**所以轮转不需要调用方配合做任何事**。
'use strict';

const fs = require('fs');
const path = require('path');

const 默认上限字节 = 8 * 1024 * 1024;    // 8MB：约十万条 provider-runs，够翻半年
const 默认保留 = 5;

function 分名(文件, n) {
  const 目录 = path.dirname(文件);
  const 名 = path.basename(文件);
  const i = 名.lastIndexOf('.');
  return path.join(目录, i > 0 ? `${名.slice(0, i)}.${n}${名.slice(i)}` : `${名}.${n}`);
}

/**
 * 需要就转。返回 { 转: bool, 因?, 大小? }。
 * 任何失败都只是**不转**，绝不抛——轮转失败的正确后果是文件继续长，
 * 不是把正在写流水的那次调用打断（流水是证据面，宁可胖也不能断）。
 */
function 转(文件, o = {}) {
  const 上限 = Number(o.上限字节) > 0 ? Number(o.上限字节) : 默认上限字节;
  const 保留 = Number(o.保留) > 0 ? Number(o.保留) : 默认保留;
  let 大小 = 0;
  try { 大小 = fs.statSync(文件).size; } catch { return { 转: false, 因: '文件不存在' }; }
  if (大小 < 上限) return { 转: false, 大小 };
  try {
    // 从最老的往前挪，免得覆盖：N-1→N、N-2→N-1 …… 1→2，最后 本体→1
    const 最老 = 分名(文件, 保留);
    try { fs.unlinkSync(最老); } catch { /* 没有就算了 */ }
    for (let n = 保留 - 1; n >= 1; n--) {
      const 从 = 分名(文件, n); const 到 = 分名(文件, n + 1);
      try { if (fs.existsSync(从)) fs.renameSync(从, 到); } catch { /* 单份挪不动不影响其余 */ }
    }
    fs.renameSync(文件, 分名(文件, 1));
    return { 转: true, 大小, 归档: 分名(文件, 1) };
  } catch (e) { return { 转: false, 因: e.message, 大小 }; }
}

module.exports = { 转, 分名, 默认上限字节, 默认保留 };
