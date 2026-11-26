import { createClient } from "@supabase/supabase-js";
import { authStatus } from "./server-policy.js";
let client;
export function adminClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL,
      key =
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SERVER_NOT_CONFIGURED");
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, init = {}) =>
          fetch(url, {
            ...init,
            signal: init.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)])
              : AbortSignal.timeout(8000),
          }),
      },
    });
  }
  return client;
}
export async function authenticateRequest(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const { data, error } = await adminClient().auth.getUser(header.slice(7));
  if (error) {
    if (authStatus(error) === 401) return null;
    throw error;
  }
  return data.user;
}
