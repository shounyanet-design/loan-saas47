/**
 * Professional HTML email templates (Part 12). Each template is a pure function
 * (vars) -> { subject, html }. This is a RENDERER only — it does not send mail
 * (the existing email integration is untouched); the system can pass the
 * rendered html to whatever transport it uses.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function shell({ title, intro, bodyHtml, ctaText, ctaUrl, brand = 'Point.47' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#4f46e5;color:#fff;padding:20px 24px;border-radius:16px 16px 0 0;font-weight:700;font-size:18px">${esc(brand)}</div>
    <div style="background:#fff;padding:28px 24px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
      ${intro ? `<p style="color:#475569;line-height:1.6">${esc(intro)}</p>` : ''}
      ${bodyHtml || ''}
      ${ctaText && ctaUrl ? `<p style="margin:24px 0"><a href="${esc(ctaUrl)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(ctaText)}</a></p>` : ''}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">© ${new Date().getFullYear()} ${esc(brand)}. All rights reserved.</p>
  </div>
</body></html>`;
}

const templates = {
  welcome: (v) => ({ subject: `Welcome to ${v.brand || 'Point.47'}, ${v.name || ''}`.trim(), html: shell({ title: `Welcome aboard 🎉`, intro: `Hi ${v.name || 'there'}, your workspace "${v.company || ''}" is ready.`, ctaText: 'Open Dashboard', ctaUrl: v.url, brand: v.brand }) }),
  verifyEmail: (v) => ({ subject: 'Verify your email', html: shell({ title: 'Confirm your email', intro: 'Please verify your email address to activate your account.', ctaText: 'Verify Email', ctaUrl: v.url, brand: v.brand }) }),
  passwordReset: (v) => ({ subject: 'Reset your password', html: shell({ title: 'Password reset', intro: 'We received a request to reset your password. This link expires in 1 hour.', ctaText: 'Reset Password', ctaUrl: v.url, brand: v.brand }) }),
  trialStarted: (v) => ({ subject: 'Your free trial has started', html: shell({ title: `Your ${v.plan || ''} trial is live`, intro: `You have ${v.days || 14} days to explore everything. No credit card required.`, ctaText: 'Get Started', ctaUrl: v.url, brand: v.brand }) }),
  trialEnding: (v) => ({ subject: 'Your trial is ending soon', html: shell({ title: 'Trial ending soon', intro: `Your trial ends in ${v.days || 3} days. Upgrade now to keep your data and features.`, ctaText: 'Upgrade Plan', ctaUrl: v.url, brand: v.brand }) }),
  subscriptionActivated: (v) => ({ subject: 'Subscription activated', html: shell({ title: 'Subscription activated ✅', intro: `Your ${v.plan || ''} plan is now active. Thank you for choosing us!`, ctaText: 'View Subscription', ctaUrl: v.url, brand: v.brand }) }),
  paymentSuccess: (v) => ({ subject: 'Payment received', html: shell({ title: 'Payment successful', intro: `We received your payment of ${v.amount || ''} ${v.currency || 'ZAR'}.`, ctaText: 'View Invoice', ctaUrl: v.url, brand: v.brand }) }),
  invoice: (v) => ({ subject: `Invoice ${v.invoiceNumber || ''}`, html: shell({ title: `Invoice ${v.invoiceNumber || ''}`, intro: `Amount due: ${v.total || ''} ${v.currency || 'ZAR'}. Due ${v.dueDate || 'soon'}.`, ctaText: 'View & Pay', ctaUrl: v.url, brand: v.brand }) }),
  supportReply: (v) => ({ subject: `Re: ${v.subject || 'Your support ticket'}`, html: shell({ title: 'New reply to your ticket', intro: v.preview || 'Our support team has replied to your ticket.', bodyHtml: v.body ? `<blockquote style="border-left:3px solid #e2e8f0;margin:16px 0;padding:8px 16px;color:#475569">${esc(v.body)}</blockquote>` : '', ctaText: 'View Ticket', ctaUrl: v.url, brand: v.brand }) }),
};

function render(name, vars = {}) {
  const tpl = templates[name];
  if (!tpl) throw Object.assign(new Error(`Unknown email template: ${name}`), { status: 400 });
  return tpl(vars);
}

module.exports = { render, templateNames: Object.keys(templates) };
