import { withDeadline } from "../../lib/deadline.js";
import { captureSession, setSessionOwner } from "../../lib/session-scope.js";

let client = null;
let currentSession = null;
let publicAuthConfig = null,
  authEventVersion = 0;
let currentUser = null,
  subscription = null,
  initializing = null;
let mailRetryUntil = 0;
export function getMailRetryAfter() {
  return Math.max(0, Math.ceil((mailRetryUntil - Date.now()) / 1000));
}

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
      publicAuthConfig = {
        supabaseUrl: config.supabaseUrl,
        supabasePublishableKey: config.supabasePublishableKey,
      };
      if (!client) {
        const { createClient } = await import("@supabase/supabase-js");
        signal.throwIfAborted();
        client = createClient(
          config.supabaseUrl,
          config.supabasePublishableKey,
          {
            global: {
              fetch: async (url, init = {}) => {
                const response = await fetch(url, {
                  ...init,
                  signal: init.signal
                    ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
                    : AbortSignal.timeout(15000),
                });
                if (
                  response.status === 429 &&
                  /\/auth\/v1\/(signup|recover|resend)(\?|$)/.test(String(url))
                ) {
                  const hint = response.headers.get("retry-after");
                  const seconds =
                    Number(hint) ||
                    Math.ceil((Date.parse(hint) - Date.now()) / 1000);
                  if (Number.isFinite(seconds) && seconds > 0)
                    mailRetryUntil =
                      Date.now() + Math.min(3600, seconds) * 1000;
                }
                return response;
              },
            },
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
        authEventVersion++;
        rememberSession(session);
        onSessionChange(session, event);
      }).data.subscription;
      const version = authEventVersion;
      const { data, error } = await client.auth.getSession();
      signal.throwIfAborted();
      if (error) throw error;
      if (version === authEventVersion) {
        rememberSession(data.session);
        onSessionChange(data.session);
      }
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

export function getPublicAuthConfig() {
  return publicAuthConfig;
}

let availability = null,
  availabilityRequest = null;
export function getAuthAvailability({ force = false } = {}) {
  if (availability && !force) return Promise.resolve(availability);
  if (availabilityRequest) return availabilityRequest;
  if (!publicAuthConfig) return Promise.resolve({ google: null, email: null });
  availabilityRequest = withDeadline(
    async (signal) => {
      const response = await fetch(
        publicAuthConfig.supabaseUrl + "/auth/v1/settings",
        {
          signal,
          cache: "no-store",
          headers: { apikey: publicAuthConfig.supabasePublishableKey },
        },
      );
      if (!response.ok) throw new Error("AUTH_SETTINGS_UNAVAILABLE");
      const data = await response.json();
      availability = {
        google:
          typeof data.external?.google === "boolean"
            ? data.external.google
            : null,
        email:
          typeof data.external?.email === "boolean"
            ? data.external.email
            : null,
      };
      return availability;
    },
    { timeoutMs: 4000 },
  )
    .catch(() => ({ google: null, email: null }))
    .finally(() => {
      availabilityRequest = null;
    });
  return availabilityRequest;
}
