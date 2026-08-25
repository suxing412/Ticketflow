// dependency-cycle.js — 起草期工单依赖环检测（TK-188）。
// 依赖方向为「持有依赖字段的单 → 被依赖单」；本模块不写工单文件。
const store = require('./core/store');
const inbox = require('./inbox');

const CLOSED_STATES = new Set(store.TERMINAL);

function normalizeTicketId(value) {
  const raw = String(value == null ? '' : value).trim();
  const match = raw.match(/^(?:TK|施工令)\s*-\s*(\d+)$/i);
  return match ? `TK-${Number(match[1])}` : raw;
}

function splitDependencies(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((part) => String(part == null ? '' : part)
    .split(/[，,；;、|/\s]+/)
    .map((item) => item.trim())
    .filter(Boolean));
}

function openTickets(root) {
  const tickets = [];
  for (const state of store.STATES) {
    if (CLOSED_STATES.has(state)) continue;
    for (const ticket of store.list(root, state)) tickets.push(ticket);
  }
  return tickets;
}

function makeEdge(from, to, raw, ticket) {
  return { from, to, raw, source: { ticket: normalizeTicketId(ticket.id), field: '依赖', value: raw } };
}

function analyzeTickets(tickets) {
  const nodes = new Map();
  for (const ticket of tickets || []) {
    if (!ticket || !ticket.id) continue;
    const id = normalizeTicketId(ticket.id);
    if (id && !nodes.has(id)) nodes.set(id, ticket);
  }

  const edges = [];
  const missing = [];
  const self = [];
  for (const [from, ticket] of nodes) {
    for (const raw of splitDependencies(ticket.fm && ticket.fm.依赖)) {
      const to = normalizeTicketId(raw);
      if (!to) continue;
      const edge = makeEdge(from, to, raw, ticket);
      if (to === from) {
        self.push(edge);
        edges.push(edge); // 自环也返回给体检；H61 要求它不阻断落盘。
      } else if (!nodes.has(to)) {
        missing.push(edge);
      } else {
        edges.push(edge);
      }
    }
  }

  const adjacency = new Map([...nodes.keys()].sort().map((id) => [id, []]));
  for (const edge of edges) adjacency.get(edge.from).push(edge);
  for (const list of adjacency.values()) list.sort((a, b) => a.to.localeCompare(b.to));

  const cycles = [];
  for (const component of stronglyConnected([...adjacency.keys()], adjacency)) {
    if (component.length === 1) {
      const id = component[0];
      if (adjacency.get(id).some((edge) => edge.to === id)) cycles.push([id, id]);
    } else {
      const path = pathInComponent(component, adjacency);
      if (path) cycles.push(path);
    }
  }
  cycles.sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));
  return {
    tickets: nodes.size,
    edges,
    cycles,
    blockingCycles: cycles.filter((path) => path.length > 2),
    anomalies: { missing, self },
  };
}

function stronglyConnected(nodes, adjacency) {
  let index = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(node) {
    indices.set(node, index);
    lowlinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const edge of adjacency.get(node) || []) {
      const next = edge.to;
      if (!indices.has(next)) {
        visit(next);
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(next)));
      }
    }
    if (lowlinks.get(node) !== indices.get(node)) return;
    const component = [];
    let next;
    do {
      next = stack.pop();
      onStack.delete(next);
      component.push(next);
    } while (next !== node);
    components.push(component.sort());
  }

  for (const node of nodes) if (!indices.has(node)) visit(node);
  return components;
}

function pathInComponent(component, adjacency) {
  const allowed = new Set(component);
  const start = component.slice().sort()[0];
  const path = [];
  const visiting = new Set();
  function walk(node) {
    visiting.add(node);
    path.push(node);
    for (const edge of adjacency.get(node) || []) {
      if (!allowed.has(edge.to)) continue;
      if (edge.to === start) return [...path, start];
      if (!visiting.has(edge.to)) {
        const found = walk(edge.to);
        if (found) return found;
      }
    }
    path.pop();
    visiting.delete(node);
    return null;
  }
  return walk(start);
}

function edgeForHop(report, from, to) {
  return report.edges.find((edge) => edge.from === from && edge.to === to) || null;
}

function formatCycle(path) { return path.join(' → '); }

function formatUrgent(report, pendingIds) {
  const pending = new Set((pendingIds || []).map(normalizeTicketId));
  const sections = ['# 依赖成环急件（TK-188）'];
  for (const cycle of report.blockingCycles) {
    const hops = [];
    for (let i = 0; i < cycle.length - 1; i += 1) hops.push(edgeForHop(report, cycle[i], cycle[i + 1]));
    const suggested = hops.find((edge) => edge && pending.has(edge.from)) || hops[0];
    const reason = pending.has(suggested.from)
      ? '该待落盘边引入闭环，移除或改挂即可打破该环（仅建议，须人工裁决）。'
      : '该环首条显式边按稳定排序列出供人工复核；移除或改挂即可打破该环（仅建议，须人工裁决）。';
    sections.push(
      `环路径: ${formatCycle(cycle)}`,
      '来源:',
      ...hops.map((edge) => `- ${edge.from} → ${edge.to}：${edge.source.ticket} 的 \`依赖:\` 字段写入「${edge.source.value}」`),
      '建议断点:',
      `- ${suggested.from} 的 \`依赖:\` 字段中「${suggested.source.value}」；${reason}`,
    );
  }
  return sections.join('\n');
}

function beforePersist(root, pending, opts = {}) {
  const draft = Array.isArray(pending) ? pending : [pending];
  const report = analyzeTickets([...openTickets(root), ...draft]);
  if (!report.blockingCycles.length) return { ok: true, report };
  const urgent = formatUrgent(report, draft.map((ticket) => ticket && ticket.id));
  const delivery = (opts.post || inbox.post)(root, '急', '依赖成环', urgent, {
    单号: draft.length === 1 ? normalizeTicketId(draft[0] && draft[0].id) : undefined,
    正文: urgent,
  });
  const paths = report.blockingCycles.map((path) => `环路径: ${formatCycle(path)}`).join('\n');
  return { ok: false, error: `依赖成环，阻断落盘\n${paths}`, report, urgent, delivery };
}

module.exports = {
  normalizeTicketId, splitDependencies, openTickets, analyzeTickets,
  formatCycle, formatUrgent, beforePersist,
};
