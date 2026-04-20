// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import ICAL from "https://esm.sh/ical.js@1.5.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const functionName = "sync-apple-calendar";

  try {
    console.log(`[${functionName}] START - Apple Sync Process`);
    const authHeader = req.headers.get('Authorization')
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
    
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin.from('profiles').select('apple_id, apple_app_password, timezone').eq('id', user.id).single();
    
    if (!profile?.apple_id || !profile?.apple_app_password) {
      console.log(`[${functionName}] No Apple credentials found for user ${user.id}`);
      return new Response(JSON.stringify({ count: 0, message: "No credentials" }), { headers: corsHeaders });
    }

    const userTimezone = profile.timezone || 'Australia/Melbourne';
    console.log(`[${functionName}] Using User Timezone: ${userTimezone}`);

    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'text/xml; charset=utf-8',
      'User-Agent': 'VibeCal/1.0 (iCloud Sync)',
      'Accept': '*/*',
      'Depth': '0'
    };

    // 1. Discover Principal
    const propfindPrincipal = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`;
    const principalRes = await fetch('https://caldav.icloud.com/', { method: 'PROPFIND', headers, body: propfindPrincipal });
    if (!principalRes.ok) throw new Error(`Principal discovery failed: ${principalRes.status}`);
    
    const principalText = await principalRes.text();
    const principalMatch = principalText.match(/<[^:]*:?current-user-principal[^>]*>\s*<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i);
    if (!principalMatch) throw new Error("Could not find principal href");
    const principalHref = principalMatch[1];

    // 2. Discover Calendar Home Set
    const propfindHome = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`;
    const homeRes = await fetch(`https://caldav.icloud.com${principalHref}`, { method: 'PROPFIND', headers, body: propfindHome });
    const homeText = await homeRes.text();
    const homeMatch = homeText.match(/<[^:]*:?calendar-home-set[^>]*>\s*<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i);
    if (!homeMatch) throw new Error("Could not find calendar home set");
    const homeHref = homeMatch[1];

    // 3. Discover Calendars
    const propfindCals = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>`;
    const calsRes = await fetch(homeHref, { method: 'PROPFIND', headers: { ...headers, 'Depth': '1' }, body: propfindCals });
    const calsText = await calsRes.text();
    
    const calendarPaths = [];
    const responses = calsText.split(/<[^:]*:?response/i);
    
    for (const resp of responses) {
      if (/<[^:]*:?resourcetype[^>]*>.*?<[^:]*:?calendar/is.test(resp)) {
        const hrefMatch = resp.match(/<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i);
        const nameMatch = resp.match(/<[^:]*:?displayname[^>]*>([^<]+)<\/[^>]*>/i);
        if (hrefMatch) {
          let href = hrefMatch[1];
          if (href.startsWith('/')) {
            const urlObj = new URL(homeHref);
            href = `${urlObj.protocol}//${urlObj.host}${href}`;
          }
          calendarPaths.push({ href, name: nameMatch ? nameMatch[1] : 'Untitled' });
        }
      }
    }

    // 4. Fetch Events
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);

    const startStr = syncStartTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endStr = syncEndTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const reportQuery = `<?xml version="1.0" encoding="utf-8" ?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop><C:calendar-data/></D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
              <C:time-range start="${startStr}" end="${endStr}"/>
            </C:comp-filter>
          </C:comp-filter>
        </C:filter>
      </C:calendar-query>`;

    const eventMap = new Map();
    const syncTimestamp = new Date().toISOString();

    const { data: settings } = await supabaseAdmin.from('user_settings').select('movable_keywords, locked_keywords, work_keywords').eq('user_id', user.id).single();
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];
    const workKeywords = settings?.work_keywords || ['meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 'appointment', 'coaching', 'session', 'work session'];
    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|work session|q & a|weekly|yoga|show|tech|dress|night|opening|closing|birthday|party|gala|buffer|probe|experiment|quinceanera|🎭|✨|lunch|dinner|breakfast|brunch|bump in|performance|gig|concert|wedding|funeral|doctor|dentist|flight|train|hotel|check-in|check-out|reservation|40th|50th|60th|anniversary/i;

    // Helper to convert wall-clock time to UTC based on a specific timezone
    const toUTC = (icalTime, tz) => {
      if (icalTime.isUtc) return icalTime.toJSDate();
      
      // Construct a "naive" date string from components
      const naiveStr = `${icalTime.year}-${String(icalTime.month).padStart(2, '0')}-${String(icalTime.day).padStart(2, '0')}T${String(icalTime.hour).padStart(2, '0')}:${String(icalTime.minute).padStart(2, '0')}:${String(icalTime.second).padStart(2, '0')}`;
      
      // We treat the naive string as if it were UTC, then find the offset of the target timezone at that moment
      const dateAsUTC = new Date(naiveStr + 'Z');
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
      
      const parts = formatter.formatToParts(dateAsUTC);
      const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
      const formattedStr = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}Z`;
      
      const dateInTZ = new Date(formattedStr);
      const offsetMs = dateAsUTC.getTime() - dateInTZ.getTime();
      
      return new Date(dateAsUTC.getTime() + offsetMs);
    };

    for (const cal of calendarPaths) {
      console.log(`[${functionName}] Fetching events for: ${cal.name}`);
      const eventsRes = await fetch(cal.href, { method: 'REPORT', headers: { ...headers, 'Depth': '1' }, body: reportQuery });
      if (!eventsRes.ok) continue;
      
      const eventsText = await eventsRes.text();
      const icsDatas = eventsText.match(/BEGIN:VCALENDAR.*?END:VCALENDAR/gs) || [];
      
      for (const icsData of icsDatas) {
        try {
          const jcalData = ICAL.parse(icsData);
          const vcalendar = new ICAL.Component(jcalData);
          const vevents = vcalendar.getAllSubcomponents('vevent');

          for (const vevent of vevents) {
            const event = new ICAL.Event(vevent);
            const title = event.summary || 'Untitled';
            
            const start = toUTC(event.startDate, userTimezone);
            const end = toUTC(event.endDate, userTimezone);
            
            if (title.includes("Nicole Rotenstein")) {
              console.log(`[${functionName}] DEBUG - Found Target Event: "${title}"`);
              console.log(`[${functionName}] Raw Start: ${event.startDate.toString()}`);
              console.log(`[${functionName}] Converted UTC: ${start.toISOString()}`);
            }

            const uid = event.uid;
            const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
            const isExplicitlyLocked = lockedKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
            const isLocked = isExplicitlyLocked || (!isExplicitlyMovable && fixedKeywords.test(title));
            const isWork = workKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));

            eventMap.set(uid, {
              user_id: user.id,
              event_id: uid,
              title: title,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000) || 30,
              is_locked: isLocked,
              is_work: isWork,
              provider: 'apple',
              source_calendar: cal.name,
              source_calendar_id: cal.href,
              last_synced_at: syncTimestamp,
              last_seen_at: syncTimestamp
            });
          }
        } catch (e) {
          console.error(`[${functionName}] Error parsing event:`, e.message);
        }
      }
    }

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) {
      await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
    }

    const cleanupThreshold = new Date(new Date(syncTimestamp).getTime() - 60000).toISOString();
    await supabaseAdmin.from('calendar_events_cache')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'apple')
      .gte('start_time', syncStartTime.toISOString())
      .lt('last_seen_at', cleanupThreshold);

    console.log(`[${functionName}] SUCCESS - Synced ${uniqueEvents.length} events.`);
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});