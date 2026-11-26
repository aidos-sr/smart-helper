// Supabase must consume callback credentials before navigation changes the URL.
export function hasAuthCallback({ hash = "", search = "" } = {}) {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search);
  return (
    fragment.has("access_token") ||
    fragment.has("refresh_token") ||
    fragment.has("error_description") ||
    query.has("code") ||
    query.has("error_description")
  );
}
