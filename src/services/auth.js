import { createAuthActions } from "../../lib/auth-actions.js";
import { safeStorage } from "../../lib/safe-storage.js";
import {
  getSupabaseClient,
  getAuthAvailability,
  getMailRetryAfter,
  getPublicAuthConfig,
} from "./supabase.js";
export { authErrorMessage } from "../../lib/auth-actions.js";

let initialize = async () => {};
export function configureAuthInitializer(fn) {
  initialize = fn;
}
export const authActions = createAuthActions({
  getClient: getSupabaseClient,
  initialize: () => initialize(),
  storage: safeStorage,
  projectKey: location.host,
  origin: () => location.origin,
  getAvailability: getAuthAvailability,
  getMailRetryAfter,
  getAuthOrigin: () =>
    getPublicAuthConfig()?.supabaseUrl
      ? new URL(getPublicAuthConfig().supabaseUrl).origin
      : null,
  navigate: (url) => location.assign(url),
  onMailState: (state) =>
    document.dispatchEvent(
      new CustomEvent("smart-helper:auth-mail-state", { detail: state }),
    ),
});
