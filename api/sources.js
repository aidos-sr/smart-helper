import { createClient } from '@supabase/supabase-js';
import { searchStudySources } from '../lib/study-sources.js';

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
