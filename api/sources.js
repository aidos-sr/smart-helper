import { createClient } from '@supabase/supabase-js';

const MAX_QUERY_CHARS = 360;
const TIMEOUT_MS = 7_000;
const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map();
let supabaseAdmin;

function json(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error('SUPABASE_SERVER_NOT_CONFIGURED');
  supabaseAdmin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  return supabaseAdmin;
}

async function requireUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error) throw error;
  return data.user || null;
}

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toSource({ title, url, snippet, provider, year, authors }) {
  if (!title || !url || !/^https:\/\//i.test(url)) return null;
  return {
    title: cleanText(title, 220),
    url,
    snippet: cleanText(snippet, 420),
    provider,
    ...(year ? { year: String(year) } : {}),
    ...(authors ? { authors: cleanText(authors, 140) } : {})
  };
}

async function searchOpenAlex(query) {
  const apiKey = process.env.OPENALEX_API_KEY;
  if (!apiKey) return [];
  const url = new URL('https://api.openalex.org/works');
  url.search = new URLSearchParams({
    search: query,
    per_page: '3',
    select: 'display_name,doi,publication_year,authorships,primary_location,open_access',
    api_key: apiKey
  });
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'SmartHelper/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`OPENALEX_${response.status}`);
  const data = await response.json();
  return (data.results || []).map((work) => {
    const landing = work.doi || work.primary_location?.landing_page_url || work.open_access?.oa_url;
    const authors = (work.authorships || []).slice(0, 3)
      .map((entry) => entry.author?.display_name).filter(Boolean).join(', ');
    return toSource({
      title: work.display_name,
      url: landing,
      snippet: authors ? `${authors}${work.publication_year ? ` · ${work.publication_year}` : ''}` : 'OpenAlex ғылыми еңбегі',
      provider: 'OpenAlex',
      year: work.publication_year,
      authors
    });
  }).filter(Boolean);
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function xmlText(block, tag) {
  return decodeXml(block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '');
}

async function searchArxiv(query) {
  const url = new URL('https://export.arxiv.org/api/query');
  url.search = new URLSearchParams({
    search_query: `all:${query.replace(/[+&|]/g, ' ')}`,
    start: '0',
    max_results: '3',
    sortBy: 'relevance',
    sortOrder: 'descending'
  });
  const response = await fetch(url, {
    headers: { Accept: 'application/atom+xml', 'User-Agent': 'SmartHelper/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`ARXIV_${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].slice(0, 3).map((match) => {
    const entry = match[1];
    const id = xmlText(entry, 'id');
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi)]
      .slice(0, 3).map((author) => decodeXml(author[1])).filter(Boolean).join(', ');
    const published = xmlText(entry, 'published').slice(0, 4);
    return toSource({
      title: xmlText(entry, 'title'),
      url: id,
      snippet: xmlText(entry, 'summary'),
      provider: 'arXiv',
      year: published,
      authors
    });
  }).filter(Boolean);
}

function dedupe(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (!source || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  }).slice(0, 6);
}

export async function searchStudySources(query) {
  const normalized = cleanText(query, MAX_QUERY_CHARS);
  if (!normalized) return { sources: [], status: 'no_results' };
  const cached = cache.get(normalized.toLocaleLowerCase());
  if (cached?.expiresAt > Date.now()) return cached.result;

  const settled = await Promise.allSettled([searchArxiv(normalized), searchOpenAlex(normalized)]);
  const sources = dedupe(settled.filter((item) => item.status === 'fulfilled').flatMap((item) => item.value));
  const result = {
    sources,
    status: sources.length ? 'ok' : settled.some((item) => item.status === 'fulfilled') ? 'no_results' : 'unavailable'
  };
  if (cache.size >= 80) cache.delete(cache.keys().next().value);
  cache.set(normalized.toLocaleLowerCase(), { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Тек POST сұрауы қолдау табады' });
  }

  try {
    const user = await requireUser(req);
    if (!user?.id) return json(res, 401, { error: 'Дереккөз іздеу үшін жүйеге кіріңіз' });
    const result = await searchStudySources(req.body?.query);
    return json(res, 200, result);
  } catch (error) {
    console.warn('Study source lookup failed:', error?.name || error?.message);
    return json(res, 502, { error: 'Ғылыми дереккөздер уақытша қолжетімсіз' });
  }
}
