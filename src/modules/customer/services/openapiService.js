/**
 * Developer portal (Part 6) — generates an OpenAPI 3.0 spec describing the
 * public + customer-facing API surface, plus a Postman collection derived from
 * it. The spec is curated (not auto-introspected) so it stays accurate and
 * documents only the intended public contract.
 */
const BASE = process.env.PUBLIC_API_URL || '/api';

const ENDPOINTS = [
  ['get', '/health', 'Health', 'Service health snapshot', false],
  ['get', '/health/live', 'Health', 'Liveness probe', false],
  ['get', '/health/ready', 'Health', 'Readiness probe', false],
  ['get', '/public/plans', 'Catalog', 'List public subscription plans', false],
  ['get', '/public/knowledge', 'Knowledge', 'List published help articles', false],
  ['get', '/public/knowledge/{slug}', 'Knowledge', 'Get an article by slug', false],
  ['get', '/public/announcements', 'Status', 'Active announcements', false],
  ['get', '/public/status', 'Status', 'Platform status summary', false],
  ['post', '/onboarding/start', 'Onboarding', 'Begin self-service signup', false],
  ['post', '/onboarding/provision', 'Onboarding', 'Provision the tenant', false],
  ['post', '/auth/login', 'Auth', 'Authenticate (tenant user)', false],
  ['get', '/auth/me', 'Auth', 'Current user', true],
  ['get', '/commerce/wallet', 'Wallet', 'Wallet balance', true],
  ['get', '/commerce/marketplace/products', 'Marketplace', 'List products', true],
  ['post', '/commerce/marketplace/checkout', 'Marketplace', 'Create an order', true],
  ['get', '/tenant/subscription', 'Subscription', 'Current subscription', true],
  ['get', '/tenant/usage', 'Usage', 'Usage vs limits', true],
  ['get', '/customer/support/tickets', 'Support', 'List support tickets', true],
  ['post', '/customer/support/tickets', 'Support', 'Create a support ticket', true],
  ['get', '/customer/api-keys', 'Developer', 'List API keys', true],
  ['post', '/customer/api-keys', 'Developer', 'Create an API key', true],
];

function buildSpec() {
  const paths = {};
  for (const [method, path, tag, summary, secure] of ENDPOINTS) {
    paths[path] = paths[path] || {};
    paths[path][method] = {
      tags: [tag], summary,
      ...(secure ? { security: [{ bearerAuth: [] }] } : {}),
      responses: { 200: { description: 'Success' }, 401: { description: 'Unauthorized' } },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Point.47 SaaS API', version: '1.0.0', description: 'Public + customer-facing API for the Point.47 Loan Management SaaS platform.' },
    servers: [{ url: BASE }],
    tags: [...new Set(ENDPOINTS.map((e) => e[2]))].map((t) => ({ name: t })),
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
    },
    paths,
  };
}

function buildPostman() {
  const spec = buildSpec();
  return {
    info: { name: spec.info.title, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'baseUrl', value: spec.servers[0].url }, { key: 'token', value: '' }],
    item: ENDPOINTS.map(([method, path, tag, summary, secure]) => ({
      name: `${tag} — ${summary}`,
      request: {
        method: method.toUpperCase(),
        header: secure ? [{ key: 'Authorization', value: 'Bearer {{token}}' }] : [],
        url: { raw: `{{baseUrl}}${path}`, host: ['{{baseUrl}}'], path: path.replace(/^\//, '').split('/') },
      },
    })),
  };
}

module.exports = { buildSpec, buildPostman, ENDPOINTS };
