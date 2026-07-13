/**
 * Parse common listing query params into Mongo-ready pieces.
 *
 *   ?page=1&limit=20&sort=createdAt&order=desc&search=acme&status=active
 *
 * @param {object} query - req.query
 * @param {object} opts
 * @param {string[]} opts.searchFields - fields to OR-match against `search`
 * @param {string[]} opts.filterFields - allow-listed exact-match filter fields
 * @param {string[]} opts.sortFields   - allow-listed sortable fields
 * @param {string}   opts.defaultSort
 */
function buildQuery(query = {}, opts = {}) {
  const { searchFields = [], filterFields = [], sortFields = [], defaultSort = 'createdAt' } = opts;

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const order = String(query.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const sortField = sortFields.includes(query.sort) ? query.sort : defaultSort;
  const sort = { [sortField]: order };

  const filter = {};

  // Exact-match allow-listed filters.
  for (const f of filterFields) {
    if (query[f] !== undefined && query[f] !== '') filter[f] = query[f];
  }

  // Free-text search across the configured fields (case-insensitive).
  const search = (query.search || '').trim();
  if (search && searchFields.length) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = searchFields.map((field) => ({ [field]: { $regex: safe, $options: 'i' } }));
  }

  return { page, limit, skip, sort, filter, sortField, order };
}

/** Build the standard paginated envelope. */
function paginate(items, total, page, limit) {
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

module.exports = { buildQuery, paginate };
