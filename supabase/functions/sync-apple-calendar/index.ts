// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  const functionName = "sync-apple-calendar";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // 1. Get User
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
    });
    const user = await userRes.json();
    if (!user?.id) throw new Error("Unauthorized");

    // 2. Get Apple Credentials
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=apple_id,apple_app_password`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const profiles = await profileRes.json();
    const profile = profiles[0];
    
    if (!profile?.apple_id || !profile?.apple_app_password) {
      return new Response(JSON.stringify({ count: 0, message: "No credentials" }), { headers: corsHeaders });
    }

    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'text/xml; charset=utf-8',
      'User-Agent': 'VibeCal/1.0',
      'Depth': '1'
    };

    // 3. Discover Principal & Home Set
    const baseUrl = 'https://caldav.icloud.com';
    const principalRes = await fetch(`${baseUrl}/`, { 
      method: 'PROPFIND', 
      headers: { ...headers, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>` 
    });
    const principalText = await principalRes.text();
    const principalHref = principalText.match(/<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i)?.[1];
    if (!principalHref) throw new Error("Principal not found");

    const homeRes = await fetch(principalHref.startsWith('/') ? `${baseUrl}${principalHref}` : principalHref, { 
      method: 'PROPFIND', 
      headers: { ...headers, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>` 
    });
    const homeText = await homeRes.text();
    const homeHref = homeText.match(/<[^:]*:?calendar-home-set[^>]*>\s*<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i)?.[1];
    if (!homeHref) throw new Error("Home set not found");

    // 4. Discover Calendars
    const calsRes = await fetch(homeHref.startsWith('/') ? `${baseUrl}${homeHref}` : homeHref, { 
      method: 'PROPFIND', 
      headers, 
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>` 
    });
    const calsText = await calsRes.text();
    
    const calendars = [];
    const responses = calsText.split(/<[^:]*:?response/i);
    for (const resp of responses) {
      const href = resp.match(/<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i)?.[1];
      const name = resp.match(/<[^:]*:?displayname[^>]*>([^<]+)<\/[^>]*>/i)?.[1];
      const isCalendar = /<[^:]*:?resourcetype[^>]*>.*?<[^:]*:?calendar/is.test(resp);
      if (href && isCalendar && name && !name.includes('@')) {
        calendars.push({ 
          user_id: user.id, 
          calendar_id: href.startsWith('/') ? `${baseUrl}${href}` : href, 
          calendar_name: name, 
          provider: 'apple',
          is_enabled: true
        });
      }
    }

    if (calendars.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/user_calendars?on_conflict=user_id,calendar_id`, {
        method: 'POST',
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`, 
          'Content-Type': 'application/json', 
          'Prefer': 'resolution=merge-duplicates' 
        },
        body: JSON.stringify(calendars)
      });
    }

    return new Response(JSON.stringify({ count: calendars.length }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
