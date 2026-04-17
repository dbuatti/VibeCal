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
    console.log("[sync-apple-calendar] Starting robust CalDAV discovery...");
    
    const authHeader = req.headers.get('Authorization')
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('apple_id, apple_app_password')
      .eq('id', user.id)
      .single();

    if (!profile?.apple_id || !profile?.apple_app_password) {
      throw new Error('Apple credentials missing in Settings.');
    }

    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const baseUrl = "https://caldav.icloud.com";

    // 1. Find the Principal URL
    console.log("[sync-apple-calendar] Step 1: Finding Principal...");
    const principalRes = await fetch(baseUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: `
        <d:propfind xmlns:d="DAV:">
          <d:prop>
            <d:current-user-principal />
          </d:prop>
        </d:propfind>
      `
    });

    if (!principalRes.ok) throw new Error(`Principal Discovery Failed: ${principalRes.status}`);
    const principalXml = await principalRes.text();
    const principalPath = principalXml.match(/<current-user-principal>.*?<href>(.*?)<\/href>.*?<\/current-user-principal>/s)?.[1];

    if (!principalPath) throw new Error("Could not find Principal path in Apple response.");
    console.log("[sync-apple-calendar] Principal found:", principalPath);

    // 2. Find the Calendar Home Set
    console.log("[sync-apple-calendar] Step 2: Finding Calendar Home Set...");
    const homeSetRes = await fetch(`${baseUrl}${principalPath}`, {
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: `
        <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop>
            <c:calendar-home-set />
          </d:prop>
        </d:propfind>
      `
    });

    const homeSetXml = await homeSetRes.text();
    const homeSetPath = homeSetXml.match(/<calendar-home-set>.*?<href>(.*?)<\/href>.*?<\/calendar-home-set>/s)?.[1];

    if (!homeSetPath) throw new Error("Could not find Calendar Home Set.");
    console.log("[sync-apple-calendar] Home Set found:", homeSetPath);

    // 3. Fetch events from the home set (iCloud allows REPORT on the home set to search all calendars)
    console.log("[sync-apple-calendar] Step 3: Fetching events...");
    const now = new Date();
    const start = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const reportXml = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag />
          <c:calendar-data />
        </d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="VEVENT">
              <c:time-range start="${start}" end="${end}"/>
            </c:comp-filter>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>
    `;

    const response = await fetch(`${baseUrl}${homeSetPath}`, {
      method: 'REPORT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1'
      },
      body: reportXml
    });

    if (!response.ok) throw new Error(`Event Fetch Failed: ${response.status}`);

    const xmlData = await response.text();
    const events = [];
    const eventBlocks = xmlData.split('BEGIN:VEVENT');
    
    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i];
      const summary = block.match(/SUMMARY:(.*)/)?.[1]?.trim() || 'Untitled Apple Event';
      const dtStart = block.match(/DTSTART(?:;VALUE=DATE)?:(.*)/)?.[1]?.trim();
      const dtEnd = block.match(/DTEND(?:;VALUE=DATE)?:(.*)/)?.[1]?.trim();
      const uid = block.match(/UID:(.*)/)?.[1]?.trim() || `apple-${Math.random()}`;

      if (dtStart && dtEnd) {
        const startDate = parseIcsDate(dtStart);
        const endDate = parseIcsDate(dtEnd);
        const duration = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

        events.push({
          user_id: user.id,
          event_id: uid,
          title: summary,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          duration_minutes: duration,
          is_locked: true,
          provider: 'apple',
          last_synced_at: new Date().toISOString()
        });
      }
    }

    if (events.length > 0) {
      await supabaseClient
        .from('calendar_events_cache')
        .upsert(events, { onConflict: 'user_id, event_id' });
    }

    return new Response(
      JSON.stringify({ message: 'Apple Sync successful', count: events.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("[sync-apple-calendar] Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
});

function parseIcsDate(icsDate: string) {
  const clean = icsDate.split(':')[0].replace(/[^0-9TZ]/g, '');
  const y = parseInt(clean.substring(0, 4));
  const m = parseInt(clean.substring(4, 6)) - 1;
  const d = parseInt(clean.substring(6, 8));
  
  if (clean.includes('T')) {
    const h = parseInt(clean.substring(9, 11));
    const min = parseInt(clean.substring(11, 13));
    const s = parseInt(clean.substring(13, 15));
    return new Date(Date.UTC(y, m, d, h, min, s));
  }
  return new Date(Date.UTC(y, m, d));
}