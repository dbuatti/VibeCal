// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { toDate } from 'https://esm.sh/date-fns-tz@3.2.0?deps=date-fns@3.6.0'

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

    const body = await req.json().catch(() => ({}));
    const { timeMin: customMin, timeMax: customMax } = body;

    // 1. Get User
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
    });
    const user = await userRes.json();
    if (!user?.id) throw new Error("Unauthorized");

    // 2. Get Apple Credentials
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=apple_id,apple_app_password,timezone`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const profiles = await profileRes.json();
    const profile = profiles[0];
    const userTimezone = profile?.timezone || 'Australia/Melbourne';
    
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
      const regex = new RegExp(`<[^>]*${tag}[^>]*>\\s*<[^>]*href[^>]*>([^<]+)<\\/[^>]*href>\\s*<\\/[^>]*${tag}>`, 'i');
      return xml.match(regex)?.[1];
    };

    // 3. Discover Principal & Home Set
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

    // 4. Discover Calendars
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

    // 5. Sync Calendar List
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

    // 6. Fetch Events with custom range support
    const enabledCalendars = calendarsToUpsert.filter(c => c.is_enabled);
    const allEvents = [];
    
    const startRange = customMin ? new Date(customMin).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z' : 
                      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endRange = customMax ? new Date(customMax).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z' : 
                    new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    for (const cal of enabledCalendars) {
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
        const icsBlocks = reportText.match(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi) || [];
        
        for (let i = 0; i < icsBlocks.length; i++) {
          let icsData = icsBlocks[i].replace(/^<[^>]*calendar-data[^>]*>/i, '').replace(/<\/[^>]*calendar-data>$/i, '');
          if (icsData.includes('<![CDATA[')) icsData = icsData.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] || icsData;

          const unfolded = icsData.replace(/\r\n\s/g, '');
          const summaryMatch = unfolded.match(/SUMMARY:(.*)/i);
          const uidMatch = unfolded.match(/UID:(.*)/i);
          const startMatch = unfolded.match(/DTSTART(?:;TZID=[^:]+)?[:](\d{8}T\d{6}Z?)/i);
          const endMatch = unfolded.match(/DTEND(?:;TZID=[^:]+)?[:](\d{8}T\d{6}Z?)/i);

          if (uidMatch?.[1] && startMatch?.[1] && endMatch?.[1]) {
            const parseIcalDate = (str, tz) => {
              const y = str.substring(0, 4), m = str.substring(4, 6), d = str.substring(6, 8);
              const h = str.substring(9, 11), min = str.substring(11, 13), s = str.substring(13, 15);
              const dateStr = `${y}-${m}-${d}T${h}:${min}:${s}`;
              return str.endsWith('Z') ? new Date(dateStr + 'Z').toISOString() : toDate(dateStr, { timeZone: tz }).toISOString();
            };

            allEvents.push({
              user_id: user.id,
              event_id: uidMatch[1].trim(),
              title: summaryMatch?.[1]?.trim() || 'Untitled',
              start_time: parseIcalDate(startMatch[1].trim(), userTimezone),
              end_time: parseIcalDate(endMatch[1].trim(), userTimezone),
              provider: 'apple',
              source_calendar: cal.calendar_name,
              source_calendar_id: cal.calendar_id,
              last_synced_at: new Date().toISOString()
            });
          }
        }
      } catch (err) { console.error(`[${functionName}] Error in ${cal.calendar_name}:`, err.message); }
    }

    if (allEvents.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
        method: 'POST',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(allEvents)
      });
    }

    return new Response(JSON.stringify({ count: allEvents.length }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})