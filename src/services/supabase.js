import { createClient } from '@supabase/supabase-js';

let client = null;
let currentSession = null;
let currentUser = null;

function requireClient() {
  if (!client) throw new Error('Supabase әлі дайын емес');
  return client;
}

function rememberSession(session) {
  currentSession = session || null;
  currentUser = session?.user || null;
}

export async function initializeSupabase(onSessionChange) {
  const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  const config = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(config.error || 'Supabase конфигурациясы жүктелмеді');

  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  client.auth.onAuthStateChange((_event, session) => {
    rememberSession(session);
    onSessionChange(session);
  });

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  rememberSession(data.session);
  onSessionChange(data.session);
  return client;
}

export function getSupabaseClient() {
  return client;
}

export function getRequiredSupabaseClient() {
  return requireClient();
}

export function getCurrentSession() {
  return currentSession;
}

export function getCurrentUser() {
  return currentUser;
}

export async function refreshCurrentSession() {
  const { data, error } = await requireClient().auth.refreshSession();
  if (error || !data.session) throw error || new Error('Қайта кіріп көріңіз');
  rememberSession(data.session);
  return data.session;
}
