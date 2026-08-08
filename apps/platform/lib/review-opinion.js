// review-opinion.js — 把不同 Provider 的 Markdown 评审报告归一成 UI 可读字段。
function section(text, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const source = `${String(text || '')}\n## __END__`;
  const match = source.match(new RegExp(`^##\\s+(?:${escaped})[^\\r\\n]*\\r?\\n([\\s\\S]*?)(?=^##\\s+)`, 'im'));
  return match ? match[1].trim() : '';
}

function lines(value) {
  return String(value || '').split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+] |\d+[.)]\s+|\[[ xX]\]\s*)/, '').trim())
    .filter((line) => line && !/^结论[:：]/.test(line)).slice(0, 12);
}

function tailSection(text, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(text || '').match(new RegExp(`^##\\s+(?:${escaped})[^\\r\\n]*\\r?\\n([\\s\\S]*)$`, 'im'));
  return match ? match[1].trim() : '';
}

function parse(text, fallbackPassed, meta = {}) {
  const raw = String(text || '').trim();
  const explicit = raw.match(/结论[:：]\s*(通过|不过)/);
  const passed = explicit ? explicit[1] === '通过' : fallbackPassed !== false;
  let issues = lines(section(raw, ['阻断问题', '问题', '未通过原因', '必须修复']));
  if (issues.every((line) => /^无[。.]?$/.test(line))) issues = [];
  const risks = lines(section(raw, ['潜在风险与漏洞', '潜在风险', '风险与漏洞', '剩余风险', '漏洞']));
  const evidence = lines(section(raw, ['验收证据', '证据', '核验依据', '验证结果']));
  if (!passed && !issues.length) {
    issues = raw.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !/^结论[:：]/.test(line)).slice(0, 6);
  }
  return {
    类型: meta.类型 || 'QA质检', 结论: passed ? '通过' : '不过',
    评审人: meta.评审人 || null, provider: meta.provider || null, model: meta.model || null,
    时间: meta.时间 || new Date().toISOString(), 问题: issues, 风险: risks, 证据: evidence,
    原文: raw.slice(0, 8000),
  };
}

function append(fm, review) {
  const history = Array.isArray(fm.评审记录) ? fm.评审记录 : [];
  fm.评审记录 = [...history, review].slice(-6);
  fm.最新评审 = review;
}

function fromTicket(ticket, receipt) {
  const fm = ticket.fm || {};
  if (Array.isArray(fm.评审记录) && fm.评审记录.length) return fm.评审记录;
  if (fm.最新评审) return [fm.最新评审];
  const raw = String(receipt || '');
  const qa = tailSection(raw, ['QA 评审意见']);
  if (qa) return [parse(qa, !/结论[:：]\s*不过/.test(qa), { 类型: 'QA质检', 评审人: fm.质检人 })];
  const audit = tailSection(raw, ['委托代核']);
  if (audit) return [parse(audit, fm.代核 && fm.代核.结论 === '通过', {
    类型: '委托代核', 时间: fm.代核 && fm.代核.时间,
  })];
  const arbitration = tailSection(raw, ['委托代裁']);
  if (arbitration) return [parse(arbitration, false, {
    类型: '委托代裁', 时间: fm.代裁 && fm.代裁.时间,
  })];
  return [];
}

module.exports = { section, tailSection, lines, parse, append, fromTicket };
