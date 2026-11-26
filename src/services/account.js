import { createAccountActions } from "../../lib/account-actions.js";
import { getCurrentSession, getPublicAuthConfig } from "./supabase.js";
export const { requestAccount, updatePassword } = createAccountActions({
  getSession: getCurrentSession,
  getAuthConfig: getPublicAuthConfig,
});
