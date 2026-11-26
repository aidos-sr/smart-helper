import { withDeadline } from "../../lib/deadline.js";
import { captureSession, setSessionOwner } from "../../lib/session-scope.js";

let client = null;
let currentSession = null;
let currentUser = null,
  subscription = null,
  initializing = null;

function requireClient() {
  if (!client) throw new Error("Supabase әлі дайын емес");
  return client;
}

function rememberSession(session) {
  setSessionOwner(session?.user?.id);
  currentSession = session || null;
  currentUser = session?.user || null;
}

export function initializeSupabase(onSessionChange) {
  if (initializing) return initializing;
  initializing = withDeadline(
    async (signal) => {
      const response = await fetch("/api/config", {
        signal,
        headers: { Accept: "application/json" },
      });
      const config = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(config.error || "Конфигурация жүктелмеді");
      if (!client) {
        const { createClient } = await import("@supabase/supabase-js");
        signal.throwIfAborted();
        client = createClient(
          config.supabaseUrl,
          config.supabasePublishableKey,
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
            },
          },
        );
      }
      subscription?.unsubscribe();
      subscription = client.auth.onAuthStateChange((event, session) => {
        rememberSession(session);
        onSessionChange(session, event);
      }).data.subscription;
      const { data, error } = await client.auth.getSession();
      signal.throwIfAborted();
      if (error) throw error;
      rememberSession(data.session);
      onSessionChange(data.session);
      return client;
    },
    { timeoutMs: 15000 },
  ).finally(() => {
    initializing = null;
  });
  return initializing;
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
  const scope = captureSession();
  const { data, error } = await requireClient().auth.refreshSession();
  if (error || !data.session) throw error || new Error("Қайта кіріп көріңіз");
  scope.assert();
  rememberSession(data.session);
  return data.session;
}
