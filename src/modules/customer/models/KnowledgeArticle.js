const mongoose = require('mongoose');

/**
 * KnowledgeArticle — PLATFORM-global documentation/help content (shared across
 * all tenants and the public site). Not tenant-scoped.
 */
const CATEGORIES = ['getting_started', 'administration', 'borrowers', 'loans', 'payments', 'marketplace', 'wallet', 'billing', 'subscriptions', 'white_label', 'api', 'troubleshooting', 'faq'];

const knowledgeArticleSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, default: 'getting_started', index: true },
    summary: { type: String, default: '' },
    body: { type: String, default: '' }, // markdown
    tags: { type: [String], default: [] },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

knowledgeArticleSchema.index({ title: 'text', summary: 'text', body: 'text', tags: 'text' });
knowledgeArticleSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('KnowledgeArticle', knowledgeArticleSchema);
