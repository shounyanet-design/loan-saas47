const dns = require('dns').promises;
const punycode = require('punycode/');
const TenantDomain = require('../../../models/TenantDomain');
const logger = require('./loggingService');

// Abstract Provider Interface
class DomainProvider {
  async checkAvailability(domain) {
    throw new Error('Method not implemented');
  }
}

// Default Heuristic Provider using DNS lookups and local DB checks
class DefaultHeuristicProvider extends DomainProvider {
  async checkAvailability(domain) {
    // 1. Check if it's already registered in our system
    const existing = await TenantDomain.findOne({ domain });
    if (existing) {
      return { status: 'unavailable', reason: 'Already registered on platform' };
    }

    // 2. Reserved TLDs / internal domains
    const reservedTlds = ['.local', '.test', '.example', '.invalid', '.localhost'];
    if (reservedTlds.some(tld => domain.endsWith(tld)) || domain === 'localhost' || domain === '127.0.0.1') {
      return { status: 'reserved', reason: 'Reserved or internal domain' };
    }

    // 3. Invalid characters
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
    if (!domainRegex.test(domain)) {
      return { status: 'invalid', reason: 'Invalid domain format' };
    }

    // 4. DNS simulated WHOIS check
    // A real domain registrar API is required for 100% accurate WHOIS.
    // As a heuristic, if a domain has ANY DNS records (NS, A, SOA), it is highly likely registered.
    try {
      // Check NS records first (most reliable indicator of a registered domain)
      const nsRecords = await dns.resolveNs(domain);
      
      // Attempt to identify registrar from NS records
      let detectedRegistrar = 'Unknown Registrar';
      const nsString = nsRecords.join(' ').toLowerCase();
      if (nsString.includes('domaincontrol.com')) detectedRegistrar = 'GoDaddy';
      else if (nsString.includes('cloudflare.com')) detectedRegistrar = 'Cloudflare';
      else if (nsString.includes('namecheap.com') || nsString.includes('registrar-servers.com')) detectedRegistrar = 'Namecheap';
      else if (nsString.includes('hostinger.com')) detectedRegistrar = 'Hostinger';
      else if (nsString.includes('awsdns')) detectedRegistrar = 'AWS Route 53';
      else if (nsString.includes('googledomains.com')) detectedRegistrar = 'Google Domains';
      
      return { status: 'unavailable', reason: 'Domain is active', registrar: detectedRegistrar };
    } catch (nsError) {
      if (nsError.code === 'ENODATA' || nsError.code === 'ENOTFOUND') {
        try {
          // Fallback to SOA
          await dns.resolveSoa(domain);
          return { status: 'unavailable', reason: 'Domain is active (SOA record found)' };
        } catch (soaError) {
          // If neither NS nor SOA exist, it MIGHT be available.
          // Note: Premium domains held by registrars without DNS will false positive here.
          return { status: 'available', reason: 'No DNS records found' };
        }
      }
      return { status: 'unknown', reason: `DNS lookup failed: ${nsError.message}` };
    }
  }
}

class DomainAvailabilityService {
  constructor() {
    this.provider = new DefaultHeuristicProvider();
    this.cache = new Map(); // Simple in-memory cache
    this.CACHE_TTL = 1000 * 60 * 60; // 1 hour
  }

  setProvider(provider) {
    this.provider = provider;
  }

  async checkAvailability(domain) {
    // IDN Support (convert unicode domains to punycode)
    let searchDomain = domain.toLowerCase().trim();
    if (/[^a-z0-9.-]/.test(searchDomain)) {
      searchDomain = punycode.toASCII(searchDomain);
    }

    if (this.cache.has(searchDomain)) {
      const entry = this.cache.get(searchDomain);
      if (Date.now() - entry.timestamp < this.CACHE_TTL) {
        return entry.data;
      }
      this.cache.delete(searchDomain);
    }

    const result = await this.provider.checkAvailability(searchDomain);
    
    // Generate suggestions if unavailable
    let suggestions = [];
    if (result.status === 'unavailable' || result.status === 'premium') {
      suggestions = await this.generateSuggestions(searchDomain);
    }

    const response = {
      domain: searchDomain,
      ...result,
      suggestions
    };

    this.cache.set(searchDomain, { timestamp: Date.now(), data: response });
    return response;
  }

  async generateSuggestions(domain) {
    const parts = domain.split('.');
    const tld = parts.pop();
    const basename = parts.join('.');

    const candidates = new Set();
    const alternativeTlds = ['net', 'co', 'app', 'io', 'africa', 'online', 'biz'];
    
    // 1. Alternative TLDs
    alternativeTlds.forEach(alt => {
      if (alt !== tld) candidates.add(`${basename}.${alt}`);
    });

    // 2. Prefixes
    candidates.add(`get${basename}.${tld}`);
    candidates.add(`my${basename}.${tld}`);
    candidates.add(`the${basename}.${tld}`);

    // 3. Hyphens (if no hyphen exists, insert one in the middle)
    if (!basename.includes('-') && basename.length > 4) {
      const mid = Math.floor(basename.length / 2);
      candidates.add(`${basename.slice(0, mid)}-${basename.slice(mid)}.${tld}`);
    }

    // 4. Plurals / suffixes
    if (!basename.endsWith('s')) candidates.add(`${basename}s.${tld}`);
    candidates.add(`${basename}group.${tld}`);

    const verifiedSuggestions = [];
    
    // We only verify a handful of candidates to avoid overwhelming the DNS resolver
    const candidateArray = Array.from(candidates).slice(0, 5);
    
    for (const candidate of candidateArray) {
      const res = await this.provider.checkAvailability(candidate);
      if (res.status === 'available') {
        verifiedSuggestions.push(candidate);
      }
    }

    return verifiedSuggestions;
  }
}

module.exports = new DomainAvailabilityService();
