// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { toDate, formatInTimeZone } from 'https://esm.sh/date-fns-tz@3.2.0?deps=date-fns@3.6.0'
import { addMinutes, parseISO, isBefore, startOfDay, differenceInMinutes } from 'https://esm.sh/date-fns@3.6.0'
import { RRule, RRuleSet, rrulestr } from 'https://esm.sh/rrule@2.8.1'

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
      console.error(`[${functionName}] No Apple credentials in profile`);
      return new Response(JSON.stringify({ error: "No Apple credentials configured" }), { status: 400, headers: corsHeaders });
    }

    console.log(`[${functionName}] Credentials found for user ${user.id}`);

    // 3. Cleanup Step — delete ALL existing Apple events from cache so stale/deleted entries don't persist
    const todayStartISO = formatInTimeZone(new Date(), userTimezone, "yyyy-MM-dd'T'00:00:00XXX");
    const cleanupUrl = `${supabaseUrl}/rest/v1/calendar_events_cache?user_id=eq.${user.id}&provider=eq.apple`;
    await fetch(cleanupUrl, {
      method: 'DELETE',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    console.log(`[${functionName}] Cleanup done — deleted all Apple events from cache`);

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

    // 4. Discover Principal & Home Set
    const principalRes = await fetch(`${baseUrl}/`, { 
      method: 'PROPFIND', 
      headers: { ...headers, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>` 
    });
    const principalText = await principalRes.text();
    let principalPath = extractHref(principalText, 'current-user-principal');
    if (!principalPath) {
      principalPath = principalText.match(/href="([^"]*\/\d+\/principal\/)"/i)?.[1] || principalText.match(/>(\/\d+\/principal\/)</i)?.[1];
    }
    const principalUrl = principalPath.startsWith('http') ? principalPath : `${baseUrl}${principalPath}`;

    const homeRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: { ...headers, 'Depth': '0' },
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`
    });
    const homeText = await homeRes.text();
    let homePath = extractHref(homeText, 'calendar-home-set');
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
      const calName = name || '';
      if (href && isCalendar && name && !calName.toLowerCase().includes('reminder')) {
        discoveredCalendars.push({ user_id: user.id, calendar_id: href.startsWith('http') ? href : `${baseUrl}${href}`, calendar_name: name, provider: 'apple' });
      }
    }
    console.log(`[${functionName}] Discovered ${discoveredCalendars.length} calendars: ${discoveredCalendars.map(c => c.calendar_name).join(', ') || 'none'}`);

    // 6. Sync Calendar List
    const existingCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.apple`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const existingCals = await existingCalsRes.json();
    const calendarsToUpsert = discoveredCalendars.map(cal => {
      const existing = existingCals.find(e => e.calendar_id === cal.calendar_id);
      return { ...cal, is_enabled: existing ? existing.is_enabled : !cal.calendar_name.toLowerCase().includes('reminders') };
    });

    if (calendarsToUpsert.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/user_calendars?on_conflict=user_id,calendar_id`, {
        method: 'POST',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(calendarsToUpsert)
      });
    }

    // 6b. Fetch custom labels from user_calendars
    const updatedCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.apple&select=calendar_id,custom_label`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const updatedCals = await updatedCalsRes.json();
    const labelMap: Record<string, string> = {};
    for (const uc of updatedCals) {
      if (uc.custom_label) labelMap[uc.calendar_id] = uc.custom_label;
    }

    // 7. Fetch Events
    const enabledCalendars = calendarsToUpsert.filter(c => c.is_enabled);
    console.log(`[${functionName}] ${enabledCalendars.length} enabled calendars to fetch from`);
    const allEvents = [];
    
    const startRange = customMin ? new Date(customMin).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z' : 
                      new Date(todayStartISO).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endRange = customMax ? new Date(customMax).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z' : 
                    new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    for (const cal of enabledCalendars) {
      try {
        console.log(`[${functionName}] Fetching events from calendar: ${cal.calendar_name}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);
        const reportRes = await fetch(cal.calendar_id, {
          method: 'REPORT',
          signal: controller.signal,
          headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' },
          body: `<?xml version="1.0" encoding="utf-8" ?>
            <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
              <D:prop><C:calendar-data><C:expand start="${startRange}" end="${endRange}"/></C:calendar-data></D:prop>
              <C:filter>
                <C:comp-filter name="VCALENDAR">
                  <C:comp-filter name="VEVENT">
                    <C:time-range start="${startRange}" end="${endRange}"/>
                  </C:comp-filter>
                </C:comp-filter>
              </C:filter>
            </C:calendar-query>`
        });
        console.log(`[${functionName}] REPORT response status: ${reportRes.status} for ${cal.calendar_name}`);
        clearTimeout(timeoutId);

        const reportText = await reportRes.text();
        const icsBlocks = reportText.match(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi) || [];
        console.log(`[${functionName}] ${icsBlocks.length} ICS blocks from ${cal.calendar_name}`);
        
        for (let i = 0; i < icsBlocks.length; i++) {
          let icsData = icsBlocks[i].replace(/^<[^>]*calendar-data[^>]*>/i, '').replace(/<\/[^>]*calendar-data>$/i, '');
          if (icsData.includes('<![CDATA[')) icsData = icsData.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] || icsData;

          const unfolded = icsData.replace(/\r\n\s/g, '');
          const summaryMatch = unfolded.match(/SUMMARY:(.*)/i);
          const uidMatch = unfolded.match(/UID:(.*)/i);
          const ridMatch = unfolded.match(/RECURRENCE-ID(?:;[^:]*)?:(\d{8}T\d{6}Z?)/i);
          
          // Improved regex to handle parameters like ;TZID=...
          const startMatch = unfolded.match(/DTSTART(?:;[^:]*)?:(\d{8}T\d{6}Z?)/i);
          const endMatch = unfolded.match(/DTEND(?:;[^:]*)?:(\d{8}T\d{6}Z?)/i);
          const durationMatch = unfolded.match(/DURATION(?:;[^:]*)?:PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);

          if (uidMatch?.[1] && startMatch?.[1]) {
            const parseIcalDate = (str, tz) => {
              const y = str.substring(0, 4), m = str.substring(4, 6), d = str.substring(6, 8);
              const h = str.substring(9, 11), min = str.substring(11, 13), s = str.substring(13, 15);
              const dateStr = `${y}-${m}-${d}T${h}:${min}:${s}`;
              return str.endsWith('Z') ? new Date(dateStr + 'Z').toISOString() : toDate(dateStr, { timeZone: tz }).toISOString();
            };

            const startTime = parseIcalDate(startMatch[1].trim(), userTimezone);
            let endTime;
            
            if (endMatch?.[1]) {
              endTime = parseIcalDate(endMatch[1].trim(), userTimezone);
            } else if (durationMatch) {
              const hours = parseInt(durationMatch[1] || '0');
              const mins = parseInt(durationMatch[2] || '0');
              const secs = parseInt(durationMatch[3] || '0');
              const totalMins = (hours * 60) + mins + (secs / 60);
              endTime = addMinutes(parseISO(startTime), totalMins).toISOString();
            } else {
              endTime = addMinutes(parseISO(startTime), 30).toISOString();
            }

            const title = summaryMatch?.[1]?.trim() || 'Untitled';
            let durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
            if (durationMatch) {
              const dh = parseInt(durationMatch[1] || '0'), dm = parseInt(durationMatch[2] || '0'), ds = parseInt(durationMatch[3] || '0');
              durationMs = ((dh * 3600) + (dm * 60) + ds) * 1000;
            } else if (durationMs > 86400000) {
              const [sH, sM] = [new Date(startTime).getUTCHours(), new Date(startTime).getUTCMinutes()];
              const [eH, eM] = [new Date(endTime).getUTCHours(), new Date(endTime).getUTCMinutes()];
              durationMs = ((eH * 3600 + eM * 60) - (sH * 3600 + sM * 60)) * 1000;
              if (durationMs <= 0) durationMs += 86400000;
            }
            if (durationMs <= 0 || durationMs > 86400000) {
              console.warn(`[${functionName}] Suspicious duration ${Math.round(durationMs/3600000)}h for "${title}", defaulting to 60min`);
              durationMs = 3600000;
            }
            const durationMinutes = Math.round(durationMs / 60000);

            const rruleLine = unfolded.match(/RRULE:(.*)/i);
            if (rruleLine) {
              const rruleStr = rruleLine[1].trim().replace(/\\;/g, ';').replace(/\\,/g, ',');
              const tzid = (unfolded.match(/DTSTART;TZID=([^:]+):/i) || [])[1];
              // Parse RAW ICS local date+time (wall-clock time, not UTC)
              const rawStart = startMatch[1].trim();
              const localY = parseInt(rawStart.substring(0, 4));
              const localM = parseInt(rawStart.substring(4, 6)) - 1;
              const localD = parseInt(rawStart.substring(6, 8));
              const localH = parseInt(rawStart.substring(9, 11));
              const localMin = parseInt(rawStart.substring(11, 13));
              const localSec = parseInt(rawStart.substring(13, 15)) || 0;
              // Use midnight UTC of the LOCAL date as dtstart — keeps UTC dates aligned with local dates
              const dtstartDate = new Date(Date.UTC(localY, localM, localD, 0, 0, 0));
              try {
                const rruleOpts = RRule.parseString(rruleStr);
                rruleOpts.dtstart = dtstartDate;
                const rule = new RRule(rruleOpts);
                const rangeEnd = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
                const rangeStart = parseISO(todayStartISO);
                const occurrences = rule.between(rangeStart, rangeEnd, true);
                const exdatesRaw = unfolded.match(/EXDATE(?:;[^:]*)?:([\d,;TZ=]+)/gi);
                const exdateLocalDates = new Set<string>();
                if (exdatesRaw) {
                  for (const ex of exdatesRaw) {
                    const vals = (ex.match(/:([\d,TZ;=]+)/i)?.[1] || '').split(',');
                    for (const v of vals) {
                      const m = v.match(/(\d{8})T/);
                      if (m) exdateLocalDates.add(m[1]);
                    }
                  }
                }
                for (const occDate of occurrences) {
                  // Get the local date in user's timezone, combine with original local wall-clock time
                  const occLocalDate = formatInTimeZone(occDate, tzid || userTimezone, 'yyyy-MM-dd');
                  if (exdateLocalDates.has(occLocalDate.replace(/-/g, ''))) continue;
                  const occDtStr = `${occLocalDate}T${String(localH).padStart(2,'0')}:${String(localMin).padStart(2,'0')}:${String(localSec).padStart(2,'0')}`;
                  const occInTz = toDate(occDtStr, { timeZone: tzid || userTimezone });
                  const occStart = occInTz.toISOString();
                  const occEnd = new Date(occInTz.getTime() + durationMs).toISOString();
                  allEvents.push({
                    user_id: user.id,
                    event_id: `${uidMatch[1].trim()}_${formatInTimeZone(occInTz, tzid || userTimezone, 'yyyyMMdd')}`,
                    title,
                    start_time: occStart,
                    end_time: occEnd,
                    duration_minutes: Math.round(durationMs / 60000),
                    provider: 'apple',
                    source_calendar: labelMap[cal.calendar_id] || cal.calendar_name,
                    source_calendar_id: cal.calendar_id,
                    last_synced_at: new Date().toISOString()
                  });
                }
              } catch (e) {
                console.error(`[${functionName}] RRULE parse error for "${title}": ${rruleStr}`, e.message);
                if (!isBefore(parseISO(startTime), parseISO(todayStartISO))) {
                  const rid = ridMatch?.[1] ? ridMatch[1].trim() : null;
                  allEvents.push({
                    user_id: user.id,
                    event_id: rid ? `${uidMatch[1].trim()}_${rid}` : uidMatch[1].trim(),
                    title, start_time: startTime, end_time: endTime,
                    duration_minutes: durationMinutes, provider: 'apple',
                    source_calendar: labelMap[cal.calendar_id] || cal.calendar_name,
                    source_calendar_id: cal.calendar_id,
                    last_synced_at: new Date().toISOString()
                  });
                }
              }
            } else {
              if (!isBefore(parseISO(startTime), parseISO(todayStartISO))) {
                const rid = ridMatch?.[1] ? ridMatch[1].trim() : null;
                allEvents.push({
                  user_id: user.id,
                  event_id: rid ? `${uidMatch[1].trim()}_${rid}` : uidMatch[1].trim(),
                  title, start_time: startTime, end_time: endTime,
                  duration_minutes: durationMinutes, provider: 'apple',
                  source_calendar: labelMap[cal.calendar_id] || cal.calendar_name,
                  source_calendar_id: cal.calendar_id,
                  last_synced_at: new Date().toISOString()
                });
              }
            }
          }
        }
      } catch (err) { console.error(`[${functionName}] Error in ${cal.calendar_name}:`, err.message); }
    }

    console.log(`[${functionName}] Total events parsed: ${allEvents.length}`);
    if (allEvents.length > 0) {
      console.log(`[${functionName}] Upserting ${allEvents.length} events to cache`);
      await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
        method: 'POST',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(allEvents)
      });
      console.log(`[${functionName}] Upsert complete`);
    }

    console.log(`[${functionName}] Returning count: ${allEvents.length}`);
    return new Response(JSON.stringify({ count: allEvents.length }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})