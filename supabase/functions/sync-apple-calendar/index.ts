// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"

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

    const baseUrl = 'https://caldav.icloud.com';
    
    const extractHref = (xml, tag) => {
      const regex = new RegExp(`<[^:]*:?${tag}[^>]*>\\s*<[^:]*:?href[^>]*>([^<]+)<\\/[^:]*:?href>\\s*<\\/[^:]*:?${tag}>`, 'i');
      return xml.match(regex)?.[1];
    };

    // 3. Discover Principal
    const principalRes = await fetch(`${baseUrl}/`, { 
      method: 'PROPFIND', 
      headers: { ...headers, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>` 
    });
    const principalText = await principalRes.text();
    let principalPath = extractHref(principalText, 'current-user-principal');
    if (!principalPath || principalPath === '/') {
      principalPath = principalText.match(/href="([^"]*\/\d+\/principal\/)"/i)?.[1] || 
                      principalText.match(/>(\/\d+\/principal\/)</i)?.[1];
    }
    if (!principalPath) throw new Error("Could not find iCloud principal path.");
    const principalUrl = principalPath.startsWith('http') ? principalPath : `${baseUrl}${principalPath}`;

    // 4. Discover Home Set
    const homeRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: { ...headers, 'Depth': '0' },
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`
    });
    const homeText = await homeRes.text();
    let homePath = extractHref(homeText, 'calendar-home-set');
    if (!homePath) {
      const dsidMatch = principalPath.match(/\/(\d+)\//);
      if (dsidMatch) homePath = `/${dsidMatch[1]}/calendars/`;
      else homePath = principalPath;
    }
    const homeUrl = homePath.startsWith('http') ? homePath : `${baseUrl}${homePath}`;

    // 5. Discover Calendars
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

    // 6. Sync Calendar List
    const existingCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.apple`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const existingCals = await existingCalsRes.json();

    const calendarsToUpsert = discoveredCalendars.map(cal => {
      const existing = existingCals.find(e => e.calendar_id === cal.calendar_id);
      let isEnabled = existing ? existing.is_enabled : false;
      if (!isEnabled && !existing && !existingCals.some(c => c.is_enabled) && !cal.calendar_name.toLowerCase().includes('reminders')) {
        isEnabled = true;
      }
      return { ...cal, is_enabled: isEnabled };
    });

    if (calendarsToUpsert.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/user_calendars?on_conflict=user_id,calendar_id`, {
        method: 'POST',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(calendarsToUpsert)
      });
    }

    // 7. Fetch Events
    const enabledCalendars = calendarsToUpsert.filter(c => c.is_enabled);
    const disabledCalendarIds = calendarsToUpsert.filter(c => !c.is_enabled).map(c => c.calendar_id);
    
    const allEvents = [];
    const now = new Date();
    const startRange = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endRange = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    for (const cal of enabledCalendars) {
      console.log(`[${functionName}] Fetching: ${cal.calendar_name}`);
      try {
        const reportRes = await fetch(cal.calendar_id, {
          method: 'REPORT',
          headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' },
          body: `<?xml version="1.0" encoding="utf-8" ?>
            <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
              <D:prop><C:calendar-data/></D:prop>
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
        console.log(`[${functionName}] Found ${eventResponses.length} responses in ${cal.calendar_name}`);

        let parsedCount = 0;
        for (const resp of eventResponses) {
          // 1. Brute Force Extract calendar-data
          const icsMatch = resp.match(/calendar-data[^>]*>([\s\S]*?)<\/.*?calendar-data>/i);
          let icsData = icsMatch?.[1];
          
          if (icsData) {
            // 2. Strip CDATA wrapper
            if (icsData.includes('<![CDATA[')) {
              icsData = icsData.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] || icsData;
            }

            // 3. Log first 100 characters for debugging (as requested)
            const debugSnippet = icsData.substring(0, 100).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
            console.log(`[${functionName}] Raw Snippet (100 chars): ${debugSnippet}`);

            // 4. Unfold lines (iCal standard: CRLF followed by a space means the line continues)
            const unfolded = icsData.replace(/\r\n\s/g, '');

            // 5. Brute Force Regex for key fields
            const summaryMatch = unfolded.match(/SUMMARY:(.*)/i);
            const uidMatch = unfolded.match(/UID:(.*)/i);
            
            // Specific regex for dates accounting for TZID and semicolons
            const startMatch = unfolded.match(/DTSTART(?:;TZID=[^:]+)?[:](\d{8}T\d{6}Z?)/i);
            const endMatch = unfolded.match(/DTEND(?:;TZID=[^:]+)?[:](\d{8}T\d{6}Z?)/i);

            const summary = summaryMatch?.[1]?.trim() || 'Untitled';
            const uid = uidMatch?.[1]?.trim();
            const dtstart = startMatch?.[1]?.trim();
            const dtend = endMatch?.[1]?.trim();

            if (uid && dtstart && dtend) {
              const parseIcalDate = (str) => {
                // Handle 20260310T120000 format
                const y = str.substring(0, 4), m = str.substring(4, 6), d = str.substring(6, 8);
                const h = str.substring(9, 11), min = str.substring(11, 13), s = str.substring(13, 15);
                // Note: This creates a local date object. If 'Z' is present, it's UTC.
                // Apple usually provides local time + TZID, so we treat as local if no Z.
                const dateStr = `${y}-${m}-${d}T${h}:${min}:${s}${str.endsWith('Z') ? 'Z' : ''}`;
                return new Date(dateStr).toISOString();
              };

              try {
                allEvents.push({
                  user_id: user.id,
                  event_id: uid,
                  title: summary,
                  start_time: parseIcalDate(dtstart),
                  end_time: parseIcalDate(dtend),
                  provider: 'apple',
                  source_calendar: cal.calendar_name,
                  source_calendar_id: cal.calendar_id,
                  last_synced_at: new Date().toISOString()
                });
                parsedCount++;
              } catch (e) {
                console.error(`[${functionName}] Date Parse Error for ${summary}:`, e.message);
              }
            }
          }
        }
        console.log(`[${functionName}] Successfully parsed ${parsedCount} events from ${cal.calendar_name}`);
      } catch (err) {
        console.error(`[${functionName}] Error in ${cal.calendar_name}:`, err.message);
      }
    }

    // 8. Cleanup and Upsert
    if (disabledCalendarIds.length > 0) {
      for (const calId of disabledCalendarIds) {
        await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?user_id=eq.${user.id}&source_calendar_id=eq.${encodeURIComponent(calId)}`, {
          method: 'DELETE',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
      }
    }

    if (allEvents.length > 0) {
      console.log(`[${functionName}] Upserting ${allEvents.length} total Apple events to database`);
      const upsertRes = await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
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