/**
 * Migration 009 — Seed starter knowledge-base articles + a welcome
 * announcement (idempotent by slug/title). Additive only.
 */
const KnowledgeArticle = require('../modules/customer/models/KnowledgeArticle');
const Announcement = require('../modules/customer/models/Announcement');

const ARTICLES = [
  { slug: 'getting-started', category: 'getting_started', title: 'Getting Started with Point.47', summary: 'Set up your workspace in minutes.', order: 1, body: '# Getting Started\n\n1. Create your company\n2. Verify your email\n3. Choose a plan\n4. Invite your team\n5. Start lending.' },
  { slug: 'managing-borrowers', category: 'borrowers', title: 'Managing Borrowers', summary: 'Add, verify and manage borrower profiles.', order: 1, body: '# Borrowers\n\nAdd borrowers, run verification, and track their loans from the Borrowers module.' },
  { slug: 'creating-loans', category: 'loans', title: 'Creating & Approving Loans', summary: 'The loan application workflow.', order: 1, body: '# Loans\n\nApplications flow through capture, verification, review and approval.' },
  { slug: 'wallet-and-tokens', category: 'wallet', title: 'Wallet & API Tokens', summary: 'How token billing works.', order: 1, body: '# Wallet\n\nMetered APIs (OCR, AML, Credit Bureau, FaceTec, SMS) consume tokens. Top up from the Marketplace.' },
  { slug: 'subscriptions-and-billing', category: 'billing', title: 'Subscriptions & Billing', summary: 'Plans, invoices and payments.', order: 1, body: '# Billing\n\nManage your plan, view invoices and payment history from Billing.' },
  { slug: 'white-label-branding', category: 'white_label', title: 'White-Label Branding', summary: 'Make the platform yours.', order: 1, body: '# Branding\n\nUpload your logo, set colors, add a custom domain and customize emails.' },
  { slug: 'api-quickstart', category: 'api', title: 'API Quickstart', summary: 'Authenticate and make your first call.', order: 1, body: '# API\n\nGenerate an API key in the Developer Portal, then call the documented endpoints. See /api/docs/openapi.json.' },
  { slug: 'common-issues', category: 'troubleshooting', title: 'Troubleshooting Common Issues', summary: 'Fixes for frequent problems.', order: 1, body: '# Troubleshooting\n\nLogin issues, verification failures and payment problems and how to resolve them.' },
];

async function up() {
  const summary = [];
  for (const a of ARTICLES) {
    const existing = await KnowledgeArticle.findOne({ slug: a.slug });
    if (existing) { summary.push({ slug: a.slug, action: 'exists' }); continue; }
    await KnowledgeArticle.create({ ...a, published: true });
    summary.push({ slug: a.slug, action: 'created' });
  }
  const annTitle = 'Welcome to Point.47 SaaS';
  if (!(await Announcement.findOne({ title: annTitle }))) {
    await Announcement.create({ title: annTitle, body: 'The platform is live. Explore features, pricing and docs.', type: 'release', version: '1.0.0', active: true });
    summary.push({ announcement: annTitle, action: 'created' });
  } else summary.push({ announcement: annTitle, action: 'exists' });
  console.table(summary);
  return summary;
}

async function down() {
  await KnowledgeArticle.deleteMany({ slug: { $in: ARTICLES.map((a) => a.slug) } });
  await Announcement.deleteMany({ title: 'Welcome to Point.47 SaaS' });
}

module.exports = { up, down };
