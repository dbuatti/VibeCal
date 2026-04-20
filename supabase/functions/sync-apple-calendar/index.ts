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
    
    // Try to find principal
    const principalRes = await fetch(`${baseUrl}/`, { 
      method: 'PROPFIND', 
      headers: { ...headers, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>` 
    });
    const principalText = await principalRes.text();
    let principalHref = principalText.match(/<[^:]*href[^>]*>([^<]+)<\/[^>]*>/i)?.[1] || 
                         principalText.match(/href="([^"]+)"/i)?.[1];
    
    // Fallback: if principal not found, try to use the user ID part of the email if possible, 
    // but usually we need the numeric ID. Let's try to PROPFIND the root with more depth.
    if (!principalHref) {
      console.warn(`[${functionName}] Principal not found in root, trying fallback discovery`);
      // Some accounts might need a different discovery path
    }

    if (!principalHref) {
      console.error(`[${functionName}] Principal response:`, principalText);
      throw new Error("Principal not found");
    }

    const principalUrl = principalHref.startsWith('/') ? `${baseUrl}${principalHref}` : principalHref;
    console.log(`[${functionName}] Principal URL: ${principalUrl}`);

    const homeRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: { ...headers, 'Depth': '0' },
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`
    });
    const homeText = await homeRes.text();
    let homeHref = homeText.match(/calendar-home-set[^>]*>\s*<[^:]*href[^>]*>([^<]+)<\/[^>]*>/i)?.[1] ||
                    homeText.match(/calendar-home-set[^>]*href="([^"]+)"/i)?.[1];
    
    // Fallback: if home set not found, sometimes the principal URL IS the home set or close to it
    if (!homeHref) {
      console.warn(`[${functionName}] Home set not found in principal, trying fallback`);
      homeHref = principalHref;
    }

    const homeUrl = homeHref.startsWith('/') ? `${baseUrl}${homeHref}` : homeHref;
    console.log(`[${functionName}] Home URL: ${homeUrl}`);

    // 4. Discover Calendars
    const calsRes = await fetch(homeUrl, {
      method: 'PROPFIND',
      headers,
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>`
    });
    const calsText = await calsRes.text();
    
    const discoveredCalendars = [];
    const responses = calsText.split(/<[^:]*:?response/i);
    for (const resp of responses) {
      const href = resp.match(/<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i)?.[1];
      const name = resp.match(/<[^:]*:?displayname[^>]*>([^<]+)<\/[^>]*>/i)?.[1];
      const isCalendar = /<[^:]*:?resourcetype[^>]*>.*?<[^:]*:?calendar/is.test(resp);
      if (href && isCalendar && name && !name.includes('@')) {
        discoveredCalendars.push({
          user_id: user.id,
          calendar_id: href.startsWith('/') ? `${baseUrl}${href}` : href,
          calendar_name: name,
          provider: 'apple'
        });
      }
    }
    console.log(`[${functionName}] Discovered ${discoveredCalendars.length} Apple calendars`);

    // 5. Sync Calendar List to user_calendars table
    const existingCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.apple`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const existingCals = await existingCalsRes.json();

    const calendarsToUpsert = discoveredCalendars.map(cal => {
      const existing = existingCals.find(e => e.calendar_id === cal.calendar_id);
      return {
        ...cal,
        is_enabled: existing ? existing.is_enabled : true // Default to true for Apple for now
      };
    });

    if (calendarsToUpsert.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/user_calendars?on_conflict=user_id,calendar_id`, {
        method: 'POST',
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`, 
          'Content-Type': 'application/json', 
          'Prefer': 'resolution=merge-duplicates' 
        },
        body: JSON.stringify(calendarsToUpsert)
      });
    }

    // Note: Event fetching for Apple is not yet implemented in this function.
    // It currently only handles calendar discovery and list management.

    return new Response(JSON.stringify({ count: discoveredCalendars.length }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
