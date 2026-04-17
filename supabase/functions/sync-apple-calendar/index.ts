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

    const { data: existingEvents } = await supabaseAdmin
      .from('calendar_events_cache')
      .select('event_id, is_locked')
      .eq('user_id', user.id);
    
    const existingLockStatus = new Map(existingEvents?.map(e => [e.event_id, e.is_locked]) || []);

    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('movable_keywords, locked_keywords, work_keywords')
      .eq('user_id', user.id)
      .single();
    
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];
    const workKeywords = settings?.work_keywords || ['meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 'appointment', 'coaching', 'session'];

    const { data: profile } = await supabaseAdmin.from('profiles').select('apple_id, apple_app_password, timezone').eq('id', user.id).single();
    if (!profile?.apple_id || !profile?.apple_app_password) {
      return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });
    }

    const userTimezone = profile.timezone || 'UTC';
    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const initialBase = "https://caldav.icloud.com";
    
    const getFullUrl = (path, base) => {
      if (!path) return base;
      if (path.startsWith('http')) return path;
      const urlObj = new URL(base);
      return `${urlObj.origin}${path.startsWith('/') ? '' : '/'}${path}`;
    };

    // 1. Discovery
    const principalRes = await fetch(initialBase, {
      method: 'PROPFIND',
      headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' },
      body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`
    });
    const principalXml = await principalRes.text();
    let principalPath = principalXml.match(/current-user-principal[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
    const discoveryUrl = principalPath ? getFullUrl(principalPath, initialBase) : initialBase;

    const discoveryRes = await fetch(discoveryUrl, { 
      method: 'PROPFIND', 
      headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set /></d:prop></d:propfind>` 
    });
    const discoveryXml = await discoveryRes.text();
    let homeSetPath = discoveryXml.match(/calendar-home-set[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
    if (!homeSetPath) throw new Error("Could not find Calendar Home Set.");
    const homeSetUrl = getFullUrl(homeSetPath, discoveryRes.url);

    // 2. Discovery of all calendars
    const calendarsRes = await fetch(homeSetUrl, {
      method: 'PROPFIND',
      headers: { 'Authorization': `Basic ${auth}`, 'Depth': '1' },
      body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`
    });
    const calendarsXml = await calendarsRes.text();
    const calendarResponses = calendarsXml.split('<d:response>');
    const discoveredCals = [];
    for (const resp of calendarResponses) {
      const href = resp.match(/<d:href>([^<]+)<\/d:href>/i)?.[1];
      const name = resp.match(/<d:displayname>([^<]+)<\/d:displayname>/i)?.[1] || resp.match(/displayname>([^<]+)</i)?.[1];
      const isCalendar = resp.includes('calendar') && !resp.includes('schedule-inbox') && !resp.includes('schedule-outbox') && !resp.includes('notifications');
      if (href && isCalendar) discoveredCals.push({ user_id: user.id, calendar_id: href, calendar_name: name || 'Unnamed Calendar', provider: 'apple' });
    }
    if (discoveredCals.length > 0) await supabaseAdmin.from('user_calendars').upsert(discoveredCals, { onConflict: 'user_id, calendar_id' });

    const { data: enabled } = await supabaseAdmin.from('user_calendars').select('calendar_id, calendar_name, is_enabled').eq('user_id', user.id).eq('provider', 'apple');
    const enabledCalendars = (enabled || []).filter(c => c.is_enabled);
    if (enabledCalendars.length === 0) return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });

    const syncStartTime = new Date();
    syncStartTime.setHours(0, 0, 0, 0);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);
    const startStr = syncStartTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endStr = syncEndTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const reportXml = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag /><c:calendar-data /></d:prop>
        <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${startStr}" end="${endStr}"/></c:comp-filter></c:comp-filter></c:filter>
      </c:calendar-query>
    `;

    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|work session|q & a|weekly|yoga|show|tech|dress|night|opening|closing|birthday|party|gala|buffer|probe|experiment|quinceanera|🎭|✨|lunch|dinner|breakfast|brunch|bump in|performance|gig|concert/i;
    const fixedPatterns = [/\$\d+/, /\d+\s*min/i, /between|with/i];

    const eventMap = new Map();
    const syncTimestamp = new Date().toISOString();

    const parseIcsDate = (dateStr, tzid, fallbackTz = 'UTC') => {
      if (!dateStr) return null;
      const isUtc = dateStr.endsWith('Z');
      const clean = dateStr.replace(/[^0-9]/g, '');
      if (clean.length < 8) return null;
      const year = parseInt(clean.substring(0, 4));
      const month = parseInt(clean.substring(4, 6)) - 1;
      const day = parseInt(clean.substring(6, 8));
      const hour = parseInt(clean.substring(8, 10) || 0);
      const min = parseInt(clean.substring(10, 12) || 0);
      const sec = parseInt(clean.substring(12, 14) || 0);
      if (isUtc) return new Date(Date.UTC(year, month, day, hour, min, sec));
      const targetTz = tzid || fallbackTz;
      try {
        const utcDate = new Date(Date.UTC(year, month, day, hour, min, sec));
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: targetTz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });
        const parts = formatter.formatToParts(utcDate);
        const p = {};
        parts.forEach(part => p[part.type] = part.value);
        const tzDate = new Date(Date.UTC(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day), parseInt(p.hour) === 24 ? 0 : parseInt(p.hour), parseInt(p.minute), parseInt(p.second)));
        const offset = tzDate.getTime() - utcDate.getTime();
        return new Date(utcDate.getTime() - offset);
      } catch (e) { return new Date(Date.UTC(year, month, day, hour, min, sec)); }
    };

    for (const cal of enabledCalendars) {
      const res = await fetch(getFullUrl(cal.calendar_id, homeSetUrl), {
        method: 'REPORT',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/xml', 'Depth': '1' },
        body: reportXml
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const eventDataMatches = xml.matchAll(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi);
      for (const match of eventDataMatches) {
        let icsData = match[1].trim().replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        icsData = icsData.replace(/\r\n /g, '').replace(/\n /g, '');
        const veventMatches = icsData.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi);
        for (const veventMatch of veventMatches) {
          const content = veventMatch[1];
          const summaryMatch = content.match(/SUMMARY:(.*)/i);
          const dtstartMatch = content.match(/DTSTART[^:]*:(.*)/i);
          const tzidMatch = content.match(/DTSTART;TZID=([^:;]+)/i);
          const dtendMatch = content.match(/DTEND[^:]*:(.*)/i);
          const uidMatch = content.match(/UID:(.*)/i);
          if (!dtstartMatch || !uidMatch) continue;
          const summary = (summaryMatch?.[1] || 'Untitled').trim().replace(/\\,/g, ',').replace(/\\;/g, ';');
          const start = parseIcsDate(dtstartMatch[1].trim(), tzidMatch?.[1], userTimezone);
          if (!start || start < syncStartTime) continue;
          let end = parseIcsDate(dtendMatch?.[1]?.trim(), tzidMatch?.[1], userTimezone);
          if (!end) end = new Date(start.getTime() + 30 * 60000);
          const uid = uidMatch[1].trim();
          
          // Use UID as the primary key for stability, but keep the start time in the map key for uniqueness if needed
          const uniqueId = uid; 
          
          let isLocked = existingLockStatus.has(uniqueId) ? existingLockStatus.get(uniqueId) : null;
          
          if (isLocked === null) {
            const isExplicitlyMovable = movableKeywords.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
            const isExplicitlyLocked = lockedKeywords.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
            isLocked = isExplicitlyLocked || (!isExplicitlyMovable && (fixedKeywords.test(summary) || fixedPatterns.some(p => p.test(summary))));
          }

          const isWork = workKeywords.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
          eventMap.set(uniqueId, {
            user_id: user.id, event_id: uniqueId, title: summary, start_time: start.toISOString(), end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000), is_locked: isLocked, is_work: isWork,
            provider: 'apple', source_calendar: cal.calendar_name, source_calendar_id: cal.calendar_id, last_synced_at: syncTimestamp
          });
        }
      }
    }

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'apple').lt('start_time', syncStartTime.toISOString());
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});