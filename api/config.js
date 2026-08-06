function json(res, status, payload) {
  res.setHeader(
    'Cache-Control',
    status === 200 ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' : 'no-store'
  );
  return res.status(status).json(payload);
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Тек GET сұрауы қолдау табады' });
  }

  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    return json(res, 503, { error: 'Supabase әлі бапталмаған' });
  }

  return json(res, 200, { supabaseUrl: url, supabasePublishableKey: publishableKey });
}
