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
      return new Response(JSON.stringify({ count: 0, message: "No credentials" }), { headers: corsHeaders });
    }

    const userTimezone = profile.timezone || 'Australia/Melbourne';
    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'text/xml; charset=utf-8',
      'User-Agent': 'VibeCal/1.0 (iCloud Sync)',
      'Accept': '*/*',
      'Depth': '0'
    };

    const baseUrl = 'https://caldav.icloud.com';

    // 1. Discover Principal
    const propfindPrincipal = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`;
    const principalRes = await fetch(`${baseUrl}/`, { method: 'PROPFIND', headers, body: propfindPrincipal });
    const principalText = await principalRes.text();
    const principalMatch = principalText.match(/<[^:]*:?current-user-principal[^>]*>\s*<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i);
    if (!principalMatch) throw new Error("Could not find principal href");
    const principalHref = principalMatch[1].startsWith('/') ? `${baseUrl}${principalMatch[1]}` : principalMatch[1];

    // 2. Discover Calendar Home Set
    const propfindHome = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`;
    const homeRes = await fetch(principalHref, { method: 'PROPFIND', headers, body: propfindHome });
    const homeText = await homeRes.text();
    const homeMatch = homeText.match(/<[^:]*:?calendar-home-set[^>]*>\s*<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i);
    if (!homeMatch) throw new Error("Could not find calendar home set");
    const homeHref = homeMatch[1].startsWith('/') ? `${baseUrl}${homeMatch[1]}` : homeMatch[1];

    // 3. Discover Calendars
    const propfindCals = `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>`;
    const calsRes = await fetch(homeHref, { method: 'PROPFIND', headers: { ...headers, 'Depth': '1' }, body: propfindCals });
    const calsText = await calsRes.text();
    
    const discoveredCalendarsMap = new Map();
    const seenNames = new Set();
    const responses = calsText.split(/<[^:]*:?response/i);
    
    for (const resp of responses) {
      const hrefMatch = resp.match(/<[^:]*:?href[^>]*>([^<]+)<\/[^>]*>/i);
      const nameMatch = resp.match(/<[^:]*:?displayname[^>]*>([^<]+)<\/[^>]*>/i);
      const isCalendar = /<[^:]*:?resourcetype[^>]*>.*?<[^:]*:?calendar/is.test(resp);
      
      if (hrefMatch && isCalendar) {
        let href = hrefMatch[1];
        if (href.startsWith('/')) href = `${baseUrl}${href}`;
        href = href.replace(/\/$/, ''); // Normalize: remove trailing slash
        
        const name = nameMatch ? nameMatch[1] : 'Untitled';
        
        // AGGRESSIVE FILTER: Skip delegated accounts (email addresses) and system lists
        const isEmail = name.includes('@') && name.includes('.');
        const isSystem = /reminders|tasks|inbox|outbox|notifications/i.test(name);
        
        // DE-DUPLICATION: Only keep the first instance of a calendar name
        if (!isEmail && !isSystem && !seenNames.has(name)) {
          seenNames.add(name);
          discoveredCalendarsMap.set(href, { 
            user_id: user.id,
            calendar_id: href, 
            calendar_name: name,
            provider: 'apple'
          });
        }
      }
    }

    const discoveredCalendars = Array.from(discoveredCalendarsMap.values());

    // Upsert discovered calendars
    if (discoveredCalendars.length > 0) {
      await supabaseAdmin.from('user_calendars').upsert(discoveredCalendars, { onConflict: 'user_id, calendar_id' });
    }

    // CLEANUP: Remove Apple calendars that were NOT discovered in this run
    const discoveredIds = discoveredCalendars.map(c => c.calendar_id);
    if (discoveredIds.length > 0) {
      await supabaseAdmin.from('user_calendars')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', 'apple')
        .not('calendar_id', 'in', `(${discoveredIds.map(id => `"${id}"`).join(',')})`);
    }

    // Get enabled calendars
    const { data: enabledCals } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name, is_enabled')
      .eq('user_id', user.id)
      .eq('provider', 'apple');
    
    const enabledPaths = (enabledCals || []).filter(c => c.is_enabled);

    if (enabledPaths.length === 0) {
      console.log(`[${functionName}] No Apple calendars enabled. Cleaning up cache.`);
      await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'apple');
      return new Response(JSON.stringify({ count: 0, message: "No calendars enabled" }), { headers: corsHeaders });
    }

    // 4. Fetch Events
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 30);

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
    
    const fixedKeywords = /flight|train|hotel|check-in|check-out|reservation|doctor|dentist|hospital|wedding|funeral|performance|gig|concert|show|tech|dress|opening|closing|birthday|party|gala|anniversary/i;

    const interpretFloating = (icalTime, timeZone) => {
      const s = icalTime.toString();
      if (icalTime.isUtc || icalTime.timezone) return icalTime.toJSDate().toISOString();
      const [datePart, timePart] = s.split('T');
      const [y, m, d] = datePart.split('-').map(Number);
      const [h, min, sec] = timePart.split(':').map(Number);
      const dummy = new Date(Date.UTC(y, m - 1, d, h, min, sec));
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });
      const parts = formatter.formatToParts(dummy);
      const getPart = (type) => parseInt(parts.find(p => p.type === type).value);
      const tzDate = new Date(Date.UTC(getPart('year'), getPart('month') - 1, getPart('day'), getPart('hour'), getPart('minute'), getPart('second')));
      const offsetMs = tzDate.getTime() - dummy.getTime();
      return new Date(dummy.getTime() - offsetMs).toISOString();
    };

    for (const cal of enabledPaths) {
      console.log(`[${functionName}] Fetching events for: ${cal.calendar_name}`);
      const eventsRes = await fetch(cal.calendar_id, { method: 'REPORT', headers: { ...headers, 'Depth': '1' }, body: reportQuery });
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
            const startIso = interpretFloating(event.startDate, userTimezone);
            const endIso = interpretFloating(event.endDate, userTimezone);

            const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
            const isExplicitlyLocked = lockedKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
            const isLocked = isExplicitlyLocked || (!isExplicitlyMovable && fixedKeywords.test(title));
            const isWork = workKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));

            eventMap.set(event.uid, {
              user_id: user.id,
              event_id: event.uid,
              title: title,
              description: event.description || null,
              location: event.location || null,
              start_time: startIso,
              end_time: endIso,
              duration_minutes: Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000) || 30,
              is_locked: isLocked,
              is_work: isWork,
              provider: 'apple',
              source_calendar: cal.calendar_name,
              source_calendar_id: cal.calendar_id,
              last_synced_at: syncTimestamp,
              last_seen_at: syncTimestamp
            });
          }
        } catch (e) { console.error(`[${functionName}] Error parsing event:`, e.message); }
      }
    }

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) {
      await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
    }

    const cleanupThreshold = new Date(new Date(syncTimestamp).getTime() - 60000).toISOString();
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'apple').gte('start_time', syncStartTime.toISOString()).lt('last_seen_at', cleanupThreshold);

    console.log(`[${functionName}] SUCCESS - Synced ${uniqueEvents.length} events.`);
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});