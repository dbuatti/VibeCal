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
    console.log("[sync-apple-calendar] Starting multi-stage calendar discovery...");
    
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
    const initialBase = "https://caldav.icloud.com";

    const getFullUrl = (path: string, currentBase: string) => {
      if (path.startsWith('http')) return path;
      const urlObj = new URL(currentBase);
      return `${urlObj.protocol}//${urlObj.host}${path.startsWith('/') ? '' : '/'}${path}`;
    };

    // 1. Find the Principal URL
    const principalRes = await fetch(initialBase, {
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal /></d:prop></d:propfind>`
    });

    if (!principalRes.ok) throw new Error(`Principal Discovery Failed: ${principalRes.status}`);
    const principalXml = await principalRes.text();
    const principalPath = principalXml.match(/<(?:[^:>]*:)?current-user-principal[^>]*>\s*<(?:[^:>]*:)?href[^>]*>([^<]+)/i)?.[1];
    if (!principalPath) throw new Error("Could not find Principal path.");
    
    const principalUrl = getFullUrl(principalPath, principalRes.url);

    // 2. Find the Calendar Home Set
    const homeSetRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set /></d:prop></d:propfind>`
    });

    const homeSetXml = await homeSetRes.text();
    const homeSetPath = homeSetXml.match(/<(?:[^:>]*:)?calendar-home-set[^>]*>\s*<(?:[^:>]*:)?href[^>]*>([^<]+)/i)?.[1];
    if (!homeSetPath) throw new Error("Could not find Calendar Home Set.");
    
    const homeSetUrl = getFullUrl(homeSetPath, homeSetRes.url);

    // 3. Find individual calendars and their names
    const listRes = await fetch(homeSetUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1'
      },
      body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype /><d:displayname /></d:prop></d:propfind>`
    });

    const listXml = await listRes.text();
    const discoveredCalendars = [];
    const responses = listXml.split(/<(?:[^:>]*:)?response[^>]*>/i);
    const normHomePath = homeSetPath.replace(/\/$/, '');

    for (const resp of responses) {
      if (resp.includes('<calendar') || resp.includes(':calendar')) {
        const hrefMatch = resp.match(/<(?:[^:>]*:)?href[^>]*>([^<]+)/i);
        const nameMatch = resp.match(/<(?:[^:>]*:)?displayname[^>]*>([^<]+)/i);
        const href = hrefMatch?.[1];
        const name = nameMatch?.[1] || href?.split('/').filter(Boolean).pop() || 'Unnamed Calendar';
        
        if (href) {
          const normHref = href.replace(/\/$/, '');
          if (normHref !== normHomePath) {
            discoveredCalendars.push({
              user_id: user.id,
              calendar_id: href,
              calendar_name: name,
              provider: 'apple'
            });
          }
        }
      }
    }

    // Upsert discovered calendars so user can see them in settings
    if (discoveredCalendars.length > 0) {
      await supabaseClient
        .from('user_calendars')
        .upsert(discoveredCalendars, { onConflict: 'user_id, calendar_id' });
    }

    // Fetch user's enabled calendars
    const { data: enabledCalendars } = await supabaseClient
      .from('user_calendars')
      .select('calendar_id')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .eq('provider', 'apple');

    const enabledPaths = enabledCalendars?.map(c => c.calendar_id) || [];

    if (enabledPaths.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Discovery complete. No calendars enabled for sync.', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Fetch events only for enabled calendars
    const now = new Date();
    const start = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const reportXml = `
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag /><c:calendar-data /></d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="VEVENT">
              <c:time-range start="${start}" end="${end}"/>
            </c:comp-filter>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>
    `;

    const fetchPromises = enabledPaths.map(async (path) => {
      const calUrl = getFullUrl(path, homeSetUrl);
      try {
        const response = await fetch(calUrl, {
          method: 'REPORT',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/xml; charset=utf-8',
            'Depth': '1'
          },
          body: reportXml
        });

        if (!response.ok) return [];

        const xmlData = await response.text();
        const unfolded = xmlData.replace(/\r?\n /g, '');
        const eventBlocks = unfolded.split('BEGIN:VEVENT');
        const events = [];
        
        for (let i = 1; i < eventBlocks.length; i++) {
          const block = eventBlocks[i];
          const summary = block.match(/^SUMMARY[^:]*:(.*)$/m)?.[1]?.trim() || 'Untitled Apple Event';
          const dtStart = block.match(/^DTSTART[^:]*:(.*)$/m)?.[1]?.trim();
          const dtEnd = block.match(/^DTEND[^:]*:(.*)$/m)?.[1]?.trim();
          const uid = block.match(/^UID[^:]*:(.*)$/m)?.[1]?.trim() || `apple-${Math.random()}`;

          if (dtStart && dtEnd) {
            try {
              const startDate = parseIcsDate(dtStart);
              const endDate = parseIcsDate(dtEnd);
              if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;

              events.push({
                user_id: user.id,
                event_id: uid,
                title: summary,
                start_time: startDate.toISOString(),
                end_time: endDate.toISOString(),
                duration_minutes: Math.round((endDate.getTime() - startDate.getTime()) / 60000),
                is_locked: true,
                provider: 'apple',
                source_calendar: path,
                last_synced_at: new Date().toISOString()
              });
            } catch (e) {
              console.warn(`[sync-apple-calendar] Failed to parse event ${uid}:`, e.message);
            }
          }
        }
        return events;
      } catch (e) {
        console.error(`[sync-apple-calendar] Error fetching ${path}:`, e.message);
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    const allEvents = results.flat();

    if (allEvents.length > 0) {
      await supabaseClient
        .from('calendar_events_cache')
        .upsert(allEvents, { onConflict: 'user_id, event_id' });
    }

    return new Response(
      JSON.stringify({ 
        message: 'Apple Sync successful', 
        count: allEvents.length,
        events: allEvents
      }),
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
  const clean = icsDate.trim().replace(/[^0-9TZ]/g, '');
  const y = parseInt(clean.substring(0, 4));
  const m = parseInt(clean.substring(4, 6)) - 1;
  const d = parseInt(clean.substring(6, 8));
  if (clean.includes('T')) {
    const h = parseInt(clean.substring(9, 11));
    const min = parseInt(clean.substring(11, 13));
    const s = parseInt(clean.substring(13, 15));
    if (clean.endsWith('Z')) return new Date(Date.UTC(y, m, d, h, min, s));
    return new Date(y, m, d, h, min, s);
  }
  return new Date(y, m, d);
}