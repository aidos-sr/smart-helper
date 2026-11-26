// Supabase must consume callback credentials before navigation changes the URL.
export function hasAuthCallback({ hash = "", search = "" } = {}) {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search);
  return (
    fragment.has("access_token") ||
    fragment.has("refresh_token") ||
    fragment.has("error_description") ||
    fragment.has("error") ||
    query.has("code") ||
    query.has("error_description") ||
    query.has("error")
  );
}

export function authCallbackError({ hash = "", search = "" } = {}) {
  for (const params of [
    new URLSearchParams(hash.replace(/^#/, "")),
    new URLSearchParams(search),
  ]) {
    if (params.has("error") || params.has("error_description"))
      return {
        code:
          params.get("error_code") || params.get("error") || "access_denied",
      };
  }
  return null;
}
