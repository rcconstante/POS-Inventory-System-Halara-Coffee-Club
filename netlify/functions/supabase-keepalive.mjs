export default async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be configured in Netlify.",
    );
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/project_keepalive`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(
      `Supabase keep-alive failed with HTTP ${response.status}: ${details}`,
    );
  }
};
