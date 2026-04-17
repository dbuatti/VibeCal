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

  try {
    console.log("[sync-apple-calendar] Starting Apple Sync...");
    
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

    // Fetch user settings for movable keywords
    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('movable_keywords')
      .eq('user_id', user.id)
      .single();
    
    const movableKeywords = settings?.movable_keywords || [];

    const { data: profile } = await supabaseAdmin.from('profiles').select('apple_id, apple_app_password, timezone').eq('id', user.id).single();
    if (!profile?.apple_id || !profile?.apple_app_password) throw new Error('Apple credentials missing.');

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
    console.log("[sync-apple-calendar] Discovering principal...");
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
      body: `<?xml version="1.0" encoding="utf-8" ?>
        <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop><c:calendar-home-set /></d:prop>
        </d:propfind>` 
    });
    const discoveryXml = await discoveryRes.text();
    let homeSetPath = discoveryXml.match(/calendar-home-set[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
    
    if (!homeSetPath) throw new Error("Could not find Calendar Home Set.");
    const homeSetUrl = getFullUrl(homeSetPath, discoveryRes.url);

    // 2. Get Enabled Calendars
    const { data: enabled } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .eq('provider', 'apple');

    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'apple');

    if (!enabled || enabled.length === 0) return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });

    // 3. Fetch Events
    const now = new Date();
    const startStr = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endStr = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const reportXml = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag /><c:calendar-data><c:expand start="${startStr}" end="${endStr}"/></c:calendar-data></d:prop>
        <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${startStr}" end="${endStr}"/></c:comp-filter></c:comp-filter></c:filter>
      </c:calendar-query>
    `;

    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|gig|work session|q & a|weekly/i;
    const fixedPatterns = [/\$\d+/, /\d+\s*min/i, /between|with/i, /[\u{1F300}-\u{1F9FF}]/u];

    const eventMap = new Map();
    for (const cal of enabled) {
      const res = await fetch(getFullUrl(cal.calendar_id, homeSetUrl), {
        method: 'REPORT',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/xml', 'Depth': '1' },
        body: reportXml
      });
      
      const xml = await res.text();
      const eventBlocks = xml.split('BEGIN:VEVENT');
      
      for (let i = 1; i < eventBlocks.length; i++) {
        const block = eventBlocks[i].replace(/\r?\n /g, '');
        const summary = block.match(/^SUMMARY[^:]*:(.*)$/m)?.[1]?.trim() || 'Untitled';
        const dtStart = block.match(/^DTSTART[^:]*:(.*)$/m)?.[1]?.trim();
        const dtEnd = block.match(/^DTEND[^:]*:(.*)$/m)?.[1]?.trim();
        const uid = block.match(/^UID[^:]*:(.*)$/m)?.[1]?.trim();

        if (dtStart && dtEnd && uid) {
          const start = parseIcsDate(dtStart, userTimezone);
          const end = parseIcsDate(dtEnd, userTimezone);
          
          // Check if title contains any user-defined movable keywords
          const isExplicitlyMovable = movableKeywords.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
          
          const isLocked = !isExplicitlyMovable && (
                           fixedKeywords.test(summary) || 
                           fixedPatterns.some(p => p.test(summary)));
          
          eventMap.set(uid, {
            user_id: user.id,
            event_id: uid,
            title: summary,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000),
            is_locked: isLocked,
            provider: 'apple',
            source_calendar: cal.calendar_name,
            last_synced_at: new Date().toISOString()
          });
        }
      }
    }

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) {
      await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
    }

    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});

function parseIcsDate(icsDate, timezone) {
  const parts = icsDate.split(':');
  const dateStr = parts[parts.length - 1].trim();
  const y = parseInt(dateStr.substring(0, 4));
  const m = parseInt(dateStr.substring(4, 6)) - 1;
  const d = parseInt(dateStr.substring(6, 8));
  
  if (dateStr.includes('T')) {
    const h = parseInt(dateStr.substring(9, 11));
    const min = parseInt(dateStr.substring(11, 13));
    const s = parseInt(dateStr.substring(13, 15));
    
    if (dateStr.endsWith('Z')) return new Date(Date.UTC(y, m, d, h, min, s));
    
    // Floating time: interpret in user's timezone
    const utcDate = new Date(Date.UTC(y, m, d, h, min, s));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false
    });
    
    const tzParts = formatter.formatToParts(utcDate);
    const tzMap = Object.fromEntries(tzParts.map(p => [p.type, p.value]));
    
    const tzDate = new Date(Date.UTC(
      parseInt(tzMap.year),
      parseInt(tzMap.month) - 1,
      parseInt(tzMap.day),
      parseInt(tzMap.hour) === 24 ? 0 : parseInt(tzMap.hour),
      parseInt(tzMap.minute),
      parseInt(tzMap.second)
    ));
    
    const diff = tzDate.getTime() - utcDate.getTime();
    return new Date(utcDate.getTime() - diff);
  }
  return new Date(Date.UTC(y, m, d));
}