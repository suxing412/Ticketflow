// 换装核验.js — 活在应用之外的一次对拍（2026-08-22 体检 #39）。
//
// **为什么不能拿 G15 自证**：G15 装在活体里。活体旧的时候，它必然缺席——
// 缺席不会报错，只会静默。08-22 实测跑着的 0.27.0 里根本没有 G15，
// 而当天的收工判据是 `grep -c G15 ≥1`（grep 的是源码）。自举缺陷靠自己补不上。
//
// 这个脚本住在 apps/studio/工具/，**不在 package.json 的 build.files 里**——
// 它不随包出货，所以它说的话不受「包里那份是不是旧的」影响。
// 用法（deploy-ritual 第 7 步）：node 工具/换装核验.js  →  必须 exit 0。
const path = require('path');

/**
 * 对拍(源, 活) —— 纯函数，判据的落点。
 * 分开成两个数而不是直接比对象，是为了让判据能真喂 (18, 15) 造一次红，
 * 不必先把活体弄旧一次。
 */
function 对拍(源, 活) {
  const a = Number(源); const b = Number(活);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return { 一致: false, 因: `闸数取不到（源码 ${源} / 活体 ${活}）——取不到就当不一致，不许当成通过` };
  }
  if (a === b) return { 一致: true, 因: `源码闸 ${a} = 活体闸 ${b}` };
  return { 一致: false, 因: `源码 ${a} ≠ 活体 ${b}——活体不是当前源码树打出来的（少的那几条闸此刻全是瞎的）` };
}

async function 取活体闸数(端点) {
  const r = await fetch(端点);
  const j = await r.json();
  return Array.isArray(j.注册) ? j.注册.length : NaN;
}

if (require.main === module) {
  (async () => {
    const 端点 = process.argv[2] || 'http://127.0.0.1:4270/api/attn';
    const 源 = require(path.join(__dirname, '..', 'lib', 'gatereg')).缺省注册表.length;
    let 活 = NaN;
    try { 活 = await 取活体闸数(端点); }
    catch (e) { console.error(`取不到活体闸表（${端点}）：${e.message}`); process.exit(1); }
    const r = 对拍(源, 活);
    console.log(`换装核验：${r.因}`);
    process.exit(r.一致 ? 0 : 1);
  })();
}

module.exports = { 对拍, 取活体闸数 };
