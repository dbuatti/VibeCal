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

    const { data: profile } = await supabaseAdmin.from('profiles').select('apple_id, apple_app_password').eq('id', user.id).single();
    if (!profile?.apple_id || !profile?.apple_app_password) throw new Error('Apple credentials missing.');

    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const initialBase = "https://caldav.icloud.com";
    
    const getFullUrl = (path, base) => {
      if (!path) return base;
      if (path.startsWith('http')) return path;
      const urlObj = new URL(base);
      return `${urlObj.origin}${path.startsWith('/') ? '' : '/'}${path}`;
    };

    // 1. Discovery - Principal & Home Set (Combined for efficiency)
    console.log("[sync-apple-calendar] Discovering Principal and Home Set...");
    const discoveryRes = await fetch(initialBase, { 
      method: 'PROPFIND', 
      headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' }, 
      body: `<?xml version="1.0" encoding="utf-8" ?>
        <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop>
            <d:current-user-principal />
            <c:calendar-home-set />
          </d:prop>
        </d:propfind>` 
    });
    const discoveryXml = await discoveryRes.text();
    
    // Try to find Home Set directly first
    let homeSetPath = discoveryXml.match(/calendar-home-set[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
    
    if (!homeSetPath) {
      // Fallback: Find Principal first, then query it
      const principalPath = discoveryXml.match(/current-user-principal[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
      if (principalPath) {
        const principalUrl = getFullUrl(principalPath, discoveryRes.url);
        console.log("[sync-apple-calendar] Home Set not in initial response. Querying Principal:", principalUrl);
        
        const homeSetRes = await fetch(principalUrl, { 
          method: 'PROPFIND', 
          headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' }, 
          body: `<?xml version="1.0" encoding="utf-8" ?>
            <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
              <d:prop><c:calendar-home-set /></d:prop>
            </d:propfind>` 
        });
        const homeSetXml = await homeSetRes.text();
        homeSetPath = homeSetXml.match(/calendar-home-set[\s\S]*?href[^>]*>([^<]+)/i)?.[1];
      }
    }

    if (!homeSetPath) {
      console.error("[sync-apple-calendar] Discovery XML Response:", discoveryXml);
      throw new Error("Could not find Calendar Home Set. Please verify your App-Specific Password.");
    }
    
    const homeSetUrl = getFullUrl(homeSetPath, discoveryRes.url);
    console.log("[sync-apple-calendar] Home Set URL found:", homeSetUrl);

    // 2. Get Enabled Calendars from DB
    const { data: enabled } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .eq('provider', 'apple');

    // Clear Apple cache for this user before re-syncing
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'apple');

    if (!enabled || enabled.length === 0) {
      // If no calendars are enabled, we should still try to discover them for the settings page
      console.log("[sync-apple-calendar] No enabled calendars. Discovering available calendars...");
      const calListRes = await fetch(homeSetUrl, {
        method: 'PROPFIND',
        headers: { 'Authorization': `Basic ${auth}`, 'Depth': '1' },
        body: `<?xml version="1.0" encoding="utf-8" ?>
          <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
            <d:prop>
              <d:displayname />
              <d:resourcetype />
            </d:prop>
          </d:propfind>`
      });
      const calListXml = await calListRes.text();
      
      // Simple parser for calendar collections
      const responses = calListXml.split(/<[^>]*response[^>]*>/i).slice(1);
      const discovered = [];
      
      for (const resp of responses) {
        const isCalendar = /calendar/i.test(resp.match(/<[^>]*resourcetype[^>]*>([\s\S]*?)<\/[^>]*resourcetype[^>]*>/i)?.[1] || '');
        if (isCalendar) {
          const href = resp.match(/<[^>]*href[^>]*>([^<]+)/i)?.[1];
          const name = resp.match(/<[^>]*displayname[^>]*>([^<]+)/i)?.[1] || 'Unnamed Calendar';
          if (href) {
            discovered.push({
              user_id: user.id,
              calendar_id: href,
              calendar_name: name,
              provider: 'apple',
              is_enabled: false
            });
          }
        }
      }
      
      if (discovered.length > 0) {
        await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' });
      }
      
      return new Response(JSON.stringify({ count: 0, message: "Discovery complete. Enable calendars in settings." }), { headers: corsHeaders });
    }

    // 3. Fetch Events with EXPANSION
    const now = new Date();
    const startStr = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endStr = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

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
      const { error: insertError } = await supabaseAdmin.from('calendar_events_cache').upsert(allEvents, { onConflict: 'user_id, event_id' });
      if (insertError) throw insertError;
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