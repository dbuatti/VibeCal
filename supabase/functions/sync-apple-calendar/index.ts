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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    const { data: profile } = await supabaseClient.from('profiles').select('apple_id, apple_app_password').eq('id', user.id).single();

    if (!profile?.apple_id || !profile?.apple_app_password) throw new Error('Apple credentials missing.');

    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    
    // 1. Discovery (Principal -> HomeSet -> Calendars)
    // ... (Discovery logic remains same but with better logging)
    const initialBase = "https://caldav.icloud.com";
    const getFullUrl = (path, base) => path.startsWith('http') ? path : new URL(base).origin + (path.startsWith('/') ? '' : '/') + path;

    const principalRes = await fetch(initialBase, { method: 'PROPFIND', headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' }, body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal /></d:prop></d:propfind>` });
    const principalXml = await principalRes.text();
    const principalPath = principalXml.match(/<href[^>]*>([^<]+)/i)?.[1];
    const principalUrl = getFullUrl(principalPath, principalRes.url);

    const homeSetRes = await fetch(principalUrl, { method: 'PROPFIND', headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' }, body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set /></d:prop></d:propfind>` });
    const homeSetXml = await homeSetRes.text();
    const homeSetPath = homeSetXml.match(/<calendar-home-set[^>]*>\s*<href[^>]*>([^<]+)/i)?.[1];
    const homeSetUrl = getFullUrl(homeSetPath, homeSetRes.url);

    // 2. Get Enabled Calendars
    const { data: enabled } = await supabaseClient
      .from('user_calendars')
      .select('calendar_id, calendar_name')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .eq('provider', 'apple');

    console.log(`[sync-apple-calendar] Found ${enabled?.length || 0} enabled Apple calendars.`);

    // Clear Apple cache
    await supabaseClient.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'apple');

    if (!enabled || enabled.length === 0) {
      return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });
    }

    // 3. Fetch Events with EXPANSION
    const now = new Date();
    const startStr = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endStr = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    // The <c:expand> tag is crucial for recurring events like "Resonance"
    const reportXml = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag />
          <c:calendar-data>
            <c:expand start="${startStr}" end="${endStr}"/>
          </c:calendar-data>
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

    const allEvents = [];
    for (const cal of enabled) {
      console.log(`[sync-apple-calendar] Fetching events for: ${cal.calendar_name}`);
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
        const uid = block.match(/^UID[^:]*:(.*)$/m)?.[1]?.trim() || `apple-${Math.random()}`;

        if (dtStart && dtEnd) {
          const start = parseIcsDate(dtStart);
          const end = parseIcsDate(dtEnd);
          allEvents.push({
            user_id: user.id,
            event_id: uid,
            title: summary,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000),
            is_locked: true,
            provider: 'apple',
            source_calendar: cal.calendar_name,
            last_synced_at: new Date().toISOString()
          })
        }
      }
    }

    if (allEvents.length > 0) {
      await supabaseClient.from('calendar_events_cache').upsert(allEvents, { onConflict: 'user_id, event_id' });
    }

    return new Response(JSON.stringify({ count: allEvents.length }), { headers: corsHeaders });
  } catch (error) {
    console.error("[sync-apple-calendar] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});

function parseIcsDate(icsDate) {
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
    return new Date(y, m, d, h, min, s);
  }
  return new Date(y, m, d);
}