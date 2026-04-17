// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

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
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('movable_keywords, locked_keywords')
      .eq('user_id', user.id)
      .single();
    
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];

    const { data: profile } = await supabaseAdmin.from('profiles').select('apple_id, apple_app_password, timezone').eq('id', user.id).single();
    if (!profile?.apple_id || !profile?.apple_app_password) {
      console.log(`[${functionName}] No Apple credentials found for user.`);
      return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });
    }

    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const initialBase = "https://caldav.icloud.com";
    
    const getFullUrl = (path, base) => {
      if (!path) return base;
      if (path.startsWith('http')) return path;
      const urlObj = new URL(base);
      return `${urlObj.origin}${path.startsWith('/') ? '' : '/'}${path}`;
    };

    // 1. Discovery
    console.log(`[${functionName}] Discovering principal...`);
    const principalRes = await fetch(initialBase, {
      method: 'PROPFIND',
      headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' },
      body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`
    });
    
    const principalXml = await principalRes.text();
    let principalPath = principalXml.match(/current-user-principal[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
    const discoveryUrl = principalPath ? getFullUrl(principalPath, initialBase) : initialBase;

    console.log(`[${functionName}] Discovering home set...`);
    const discoveryRes = await fetch(discoveryUrl, { 
      method: 'PROPFIND', 
      headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?>
        <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop><c:calendar-home-set /></d:prop>
        </d:propfind>` 
    });
    const discoveryXml = await discoveryRes.text();
    let homeSetPath = discoveryXml.match(/calendar-home-set[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
    if (!homeSetPath) throw new Error("Could not find Calendar Home Set.");
    const homeSetUrl = getFullUrl(homeSetPath, discoveryRes.url);

    // 2. Discovery of all calendars
    const calendarsRes = await fetch(homeSetUrl, {
      method: 'PROPFIND',
      headers: { 'Authorization': `Basic ${auth}`, 'Depth': '1' },
      body: `<?xml version="1.0" encoding="utf-8" ?>
        <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop>
            <d:displayname/>
            <d:resourcetype/>
          </d:prop>
        </d:propfind>`
    });
    const calendarsXml = await calendarsRes.text();
    
    const calendarResponses = calendarsXml.split('<d:response>');
    const discoveredCals = [];
    
    for (const resp of calendarResponses) {
      const href = resp.match(/<d:href>([^<]+)<\/d:href>/i)?.[1];
      const name = resp.match(/<d:displayname>([^<]+)<\/d:displayname>/i)?.[1];
      const isCalendar = resp.includes('calendar') && !resp.includes('schedule-inbox') && !resp.includes('schedule-outbox');
      
      if (href && name && isCalendar) {
        discoveredCals.push({
          user_id: user.id,
          calendar_id: href,
          calendar_name: name,
          provider: 'apple'
        });
      }
    }

    if (discoveredCals.length > 0) {
      await supabaseAdmin.from('user_calendars').upsert(discoveredCals, { onConflict: 'user_id, calendar_id' });
    }

    // 3. Get Enabled Calendars
    const { data: enabled } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name, is_enabled')
      .eq('user_id', user.id)
      .eq('provider', 'apple');

    const enabledCalendars = (enabled || []).filter(c => c.is_enabled);
    if (enabledCalendars.length === 0) {
      return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });
    }

    // 4. Fetch Events
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 30);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 730);
    
    const startStr = syncStartTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endStr = syncEndTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const reportXml = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag />
          <c:calendar-data />
        </d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="VEVENT">
              <c:time-range start="${startStr}" end="${endStr}"/>
            </c:comp-filter>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>
    `;

    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|work session|q & a|weekly|yoga/i;
    const fixedPatterns = [/\$\d+/, /\d+\s*min/i, /between|with/i];

    const eventMap = new Map();
    const syncTimestamp = new Date().toISOString();

    const parseIcsDate = (dateStr) => {
      if (!dateStr) return null;
      // Handle formats like 20260418T090000Z or 20260418T090000
      const clean = dateStr.replace(/[^0-9TZ]/g, '');
      const year = clean.substring(0, 4);
      const month = clean.substring(4, 6);
      const day = clean.substring(6, 8);
      const hour = clean.substring(9, 11);
      const min = clean.substring(11, 13);
      const sec = clean.substring(13, 15);
      
      const date = new Date(Date.UTC(
        parseInt(year), 
        parseInt(month) - 1, 
        parseInt(day), 
        parseInt(hour || 0), 
        parseInt(min || 0), 
        parseInt(sec || 0)
      ));
      
      return isNaN(date.getTime()) ? null : date;
    };

    for (const cal of enabledCalendars) {
      console.log(`[${functionName}] Fetching events for: "${cal.calendar_name}"`);
      const res = await fetch(getFullUrl(cal.calendar_id, homeSetUrl), {
        method: 'REPORT',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/xml', 'Depth': '1' },
        body: reportXml
      });
      
      if (!res.ok) continue;

      const xml = await res.text();
      const eventDataMatches = xml.matchAll(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi);
      let matchCount = 0;
      let eventCount = 0;
      
      for (const match of eventDataMatches) {
        matchCount++;
        let icsData = match[1].trim()
          .replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

        // Resilient Regex-based parsing
        const veventMatches = icsData.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi);
        
        for (const veventMatch of veventMatches) {
          const content = veventMatch[1];
          
          const summaryMatch = content.match(/SUMMARY:(.*)/i);
          const dtstartMatch = content.match(/DTSTART(?:;VALUE=DATE|;TZID=[^:]+)?:(.*)/i);
          const dtendMatch = content.match(/DTEND(?:;VALUE=DATE|;TZID=[^:]+)?:(.*)/i);
          const durationMatch = content.match(/DURATION:PT(\d+)([HMS])/i);
          const uidMatch = content.match(/UID:(.*)/i);

          if (!dtstartMatch || !uidMatch) continue;

          const summary = (summaryMatch?.[1] || 'Untitled').trim();
          const start = parseIcsDate(dtstartMatch[1].trim());
          if (!start) continue;

          let end = parseIcsDate(dtendMatch?.[1]?.trim());
          if (!end) {
            if (durationMatch) {
              const val = parseInt(durationMatch[1]);
              const unit = durationMatch[2];
              const ms = unit === 'H' ? val * 3600000 : unit === 'M' ? val * 60000 : val * 1000;
              end = new Date(start.getTime() + ms);
            } else {
              end = new Date(start.getTime() + 30 * 60000); // Default 30m
            }
          }

          const uid = uidMatch[1].trim();
          const isExplicitlyMovable = movableKeywords.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
          const isExplicitlyLocked = lockedKeywords.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
          const isLocked = isExplicitlyLocked || (!isExplicitlyMovable && (fixedKeywords.test(summary) || fixedPatterns.some(p => p.test(summary))));
          
          const uniqueId = `${uid}-${start.getTime()}`;
          eventMap.set(uniqueId, {
            user_id: user.id,
            event_id: uniqueId,
            title: summary,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000),
            is_locked: isLocked,
            provider: 'apple',
            source_calendar: cal.calendar_name,
            source_calendar_id: cal.calendar_id,
            last_synced_at: syncTimestamp
          });
          eventCount++;
        }
      }
      console.log(`[${functionName}] Processed ${matchCount} resources, found ${eventCount} events in "${cal.calendar_name}"`);
    }

    const uniqueEvents = Array.from(eventMap.values());
    console.log(`[${functionName}] Total unique events found: ${uniqueEvents.length}`);

    if (uniqueEvents.length > 0) {
      await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
      await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'apple').lt('last_synced_at', syncTimestamp);
    }

    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});