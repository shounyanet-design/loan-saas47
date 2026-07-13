const KnowledgeArticle = require('../models/KnowledgeArticle');

// Public reads
async function listPublished({ category, search } = {}) {
  const q = { published: true };
  if (category) q.category = category;
  if (search) q.$text = { $search: search };
  const proj = search ? { score: { $meta: 'textScore' } } : {};
  const sort = search ? { score: { $meta: 'textScore' } } : { category: 1, order: 1 };
  return KnowledgeArticle.find(q, proj).sort(sort).limit(200).lean();
}

async function getBySlug(slug) {
  const article = await KnowledgeArticle.findOneAndUpdate(
    { slug, published: true }, { $inc: { views: 1 } }, { new: true }
  ).lean();
  return article;
}

async function categories() {
  const counts = await KnowledgeArticle.aggregate([
    { $match: { published: true } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $project: { _id: 0, category: '$_id', count: 1 } },
  ]);
  return { all: KnowledgeArticle.CATEGORIES, counts };
}

// Admin CRUD (platform)
async function create(data) {
  if (!data.slug || !data.title) throw Object.assign(new Error('slug and title are required'), { status: 400 });
  if (await KnowledgeArticle.findOne({ slug: data.slug })) throw Object.assign(new Error('slug already exists'), { status: 409 });
  return KnowledgeArticle.create(data);
}
async function update(id, data) {
  const a = await KnowledgeArticle.findById(id);
  if (!a) throw Object.assign(new Error('Article not found'), { status: 404 });
  ['title', 'category', 'summary', 'body', 'tags', 'order', 'published'].forEach((f) => { if (data[f] !== undefined) a[f] = data[f]; });
  await a.save();
  return a;
}
async function remove(id) { return KnowledgeArticle.deleteOne({ _id: id }); }
async function listAll() { return KnowledgeArticle.find({}).sort({ category: 1, order: 1 }).lean(); }

module.exports = { listPublished, getBySlug, categories, create, update, remove, listAll };
