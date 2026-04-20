// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import ICAL from "https://esm.sh/ical.js@1.5.0"

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
      console.log(`[${functionName}] No Apple credentials found for user ${user.id}`);
      return new Response(JSON.stringify({ count: 0, message: "No credentials" }), { headers: corsHeaders });
    }

    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'text/xml; charset=utf-8',
      'User-Agent': 'iOS/17.4.1 (21E236) dataaccessd/1.0',
      'Depth': '0'
    };

    const baseUrl = 'https://caldav.icloud.com';
    
    // Helper to extract href from XML
    const extractHref = (xml, tag) => {
      const regex = new RegExp(`<[^:]*:?${tag}[^>]*>\\s*<[^:]*:?href[^>]*>([^<]+)<\\/[^:]*:?href>\\s*<\\/[^:]*:?${tag}>`, 'i');
      return xml.match(regex)?.[1];
    };

    // 3. Discover Principal
    console.log(`[${functionName}] Step 1: Discovering principal...`);
    const principalRes = await fetch(`${baseUrl}/`, { 
      method: 'PROPFIND', 
      headers, 
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>` 
    });
    
    const principalText = await principalRes.text();
    let principalPath = extractHref(principalText, 'current-user-principal');
    
    if (!principalPath || principalPath === '/') {
      // Fallback: Try to find any path that looks like a DSID (numeric ID)
      principalPath = principalText.match(/href="([^"]*\/\d+\/principal\/)"/i)?.[1] || 
                      principalText.match(/>(\/\d+\/principal\/)</i)?.[1];
    }

    if (!principalPath) {
      console.error(`[${functionName}] Principal discovery failed. Response:`, principalText.substring(0, 200));
      throw new Error("Could not find iCloud principal path. Ensure you are using an App-Specific Password.");
    }

    const principalUrl = principalPath.startsWith('http') ? principalPath : `${baseUrl}${principalPath}`;
    console.log(`[${functionName}] Principal URL: ${principalUrl}`);

    // 4. Discover Home Set
    console.log(`[${functionName}] Step 2: Discovering home set...`);
    const homeRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers,
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`
    });
    
    const homeText = await homeRes.text();
    let homePath = extractHref(homeText, 'calendar-home-set');
    
    if (!homePath) {
      // Fallback: Construct home set path from principal path if possible
      const dsidMatch = principalPath.match(/\/(\d+)\//);
      if (dsidMatch) homePath = `/${dsidMatch[1]}/calendars/`;
      else homePath = principalPath;
    }

    const homeUrl = homePath.startsWith('http') ? homePath : `${baseUrl}${homePath}`;
    console.log(`[${functionName}] Home URL: ${homeUrl}`);

    // 5. Discover Calendars
    console.log(`[${functionName}] Step 3: Discovering calendars...`);
    const calsRes = await fetch(homeUrl, {
      method: 'PROPFIND',
      headers: { ...headers, 'Depth': '1' },
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>`
    });
    const calsText = await calsRes.text();
    
    const discoveredCalendars = [];
    const responses = calsText.split(/<[^:]*:?response/i).slice(1);
    
    for (const resp of responses) {
      const href = resp.match(/<[^:]*:?href[^>]*>([^<]+)<\/[^:]*:?href>/i)?.[1];
      const name = resp.match(/<[^:]*:?displayname[^>]*>([^<]+)<\/[^:]*:?displayname>/i)?.[1];
      const isCalendar = /resourcetype[^>]*>.*?calendar/is.test(resp);
      
      if (href && isCalendar && name && !name.includes('@')) {
        discoveredCalendars.push({
          user_id: user.id,
          calendar_id: href.startsWith('http') ? href : `${baseUrl}${href}`,
          calendar_name: name,
          provider: 'apple'
        });
      }
    }

    console.log(`[${functionName}] Discovered ${discoveredCalendars.length} Apple calendars`);

    // 6. Sync Calendar List to DB
    const existingCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.apple`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const existingCals = await existingCalsRes.json();

    const calendarsToUpsert = discoveredCalendars.map(cal => {
      const existing = existingCals.find(e => e.calendar_id === cal.calendar_id);
      return {
        ...cal,
        is_enabled: existing ? existing.is_enabled : true
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

    // 7. Fetch Events for Enabled Calendars
    const enabledCalendars = calendarsToUpsert.filter(c => c.is_enabled);
    const allEvents = [];
    
    const now = new Date();
    const startRange = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endRange = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    for (const cal of enabledCalendars) {
      console.log(`[${functionName}] Fetching events for: ${cal.calendar_name}`);
      const reportRes = await fetch(cal.calendar_id, {
        method: 'REPORT',
        headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' },
        body: `<?xml version="1.0" encoding="utf-8" ?>
          <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <D:prop>
              <D:getetag/>
              <C:calendar-data/>
            </D:prop>
            <C:filter>
              <C:comp-filter name="VCALENDAR">
                <C:comp-filter name="VEVENT">
                  <C:time-range start="${startRange}" end="${endRange}"/>
                </C:comp-filter>
              </C:comp-filter>
            </C:filter>
          </C:calendar-query>`
      });

      const reportText = await reportRes.text();
      const eventResponses = reportText.split(/<[^:]*:?response/i).slice(1);
      
      for (const resp of eventResponses) {
        const icsData = resp.match(/<[^:]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:]*:?calendar-data>/i)?.[1];
        if (!icsData) continue;

        try {
          const jcalData = ICAL.parse(icsData.trim());
          const vcalendar = new ICAL.Component(jcalData);
          const vevents = vcalendar.getAllSubcomponents('vevent');

          for (const vevent of vevents) {
            const event = new ICAL.Event(vevent);
            allEvents.push({
              user_id: user.id,
              event_id: event.uid,
              title: event.summary || 'Untitled',
              start_time: event.startDate.toJSDate().toISOString(),
              end_time: event.endDate.toJSDate().toISOString(),
              provider: 'apple',
              source_calendar: cal.calendar_name,
              source_calendar_id: cal.calendar_id,
              last_synced_at: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error(`[${functionName}] Error parsing ICS for event in ${cal.calendar_name}:`, e.message);
        }
      }
    }

    // 8. Upsert Events to Cache
    if (allEvents.length > 0) {
      console.log(`[${functionName}] Upserting ${allEvents.length} Apple events to cache`);
      await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
        method: 'POST',
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`, 
          'Content-Type': 'application/json', 
          'Prefer': 'resolution=merge-duplicates' 
        },
        body: JSON.stringify(allEvents)
      });
    }

    return new Response(JSON.stringify({ count: allEvents.length }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})