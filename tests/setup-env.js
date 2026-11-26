// Tests run during deployment, where production provider settings and secrets
// are present. Each test worker starts with a clean application environment;
// individual suites explicitly install their own configuration and fetch mocks.
// This hook affects only the test subprocess, never the deployed application.
for (const name of Object.keys(process.env)) {
  if (
    /^(AI_|OPENROUTER_|GEMINI_|SUPABASE_|OPENALEX_)/.test(name) ||
    name === "PUBLIC_SITE_URL"
  ) {
    delete process.env[name];
  }
}
