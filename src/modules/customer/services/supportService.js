const tenantContext = require('../../../tenancy/tenantContext');
const SupportTicket = require('../models/SupportTicket');

function ticketNumber() {
  const [s, ns] = process.hrtime();
  const n = (s * 1000 + Math.floor(ns / 1e6)) % 1000000;
  return `TKT-${String(n).padStart(6, '0')}`;
}

// Tenant-context handlers (customer side).
async function create({ subject, category, priority, body, email }) {
  if (!subject || !body) throw Object.assign(new Error('subject and body are required'), { status: 400 });
  for (let i = 0; i < 5; i++) {
    try {
      return await SupportTicket.create({
        ticketNumber: ticketNumber(), subject, category, priority,
        createdByEmail: email, lastReplyAt: new Date(),
        messages: [{ authorType: 'customer', authorEmail: email, body }],
      });
    } catch (e) { if (e.code === 11000 && i < 4) continue; throw e; }
  }
}

async function reply(ticketId, { body, email, authorType = 'customer' }) {
  if (!body) throw Object.assign(new Error('body is required'), { status: 400 });
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  ticket.messages.push({ authorType, authorEmail: email, body });
  ticket.lastReplyAt = new Date();
  if (authorType === 'agent' && ticket.status === 'open') ticket.status = 'pending';
  await ticket.save();
  return ticket;
}

async function setStatus(ticketId, status) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  ticket.status = status;
  await ticket.save();
  return ticket;
}

async function listForTenant({ status } = {}) {
  const q = {}; if (status) q.status = status;
  return SupportTicket.find(q).sort({ lastReplyAt: -1 }).limit(200).lean();
}

// Platform side (super admin) — all tenants, SYSTEM mode.
async function listAll({ status, tenantId } = {}) {
  return tenantContext.runAsSystem(() => {
    const q = {}; if (status) q.status = status; if (tenantId) q.tenantId = tenantId;
    return SupportTicket.find(q).sort({ lastReplyAt: -1 }).limit(500).lean();
  });
}
async function agentReply(tenantId, ticketId, { body, email }) {
  return tenantContext.runAsSystem(() => reply(ticketId, { body, email, authorType: 'agent' }));
}

module.exports = { create, reply, setStatus, listForTenant, listAll, agentReply };
