// @ts-nocheck
// Creates events in Apple Calendar via CalDAV and caches them in Supabase.
// Deploy with: supabase functions deploy create-appointment --project-ref <ref>
import { formatInTimeZone } from 'https://esm.sh/date-fns-tz@3.2.0?deps=date-fns@3.6.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Generate a UID for iCalendar events
const generateUID = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}@vibecal.local`;
};

// Format a Date to iCalendar UTC datetime string (e.g. 20260705T010000Z)
const toICSDate = (isoString: string): string => {
  const d = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

// Escape text for iCalendar
const escapeICS = (text: string): string => {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
};

// Build a VEVENT iCalendar string
const buildVEVENT = (event: any, uid: string, tzid: string): string => {
  const dtStart = toICSDate(event.startDateTime);
  const dtEnd = toICSDate(event.endDateTime);
  const dtStamp = toICSDate(new Date().toISOString());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VibeCal//Apple Calendar Import//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICS(event.title)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeICS(event.location)}`);
  }

  const descParts = [];
  if (event.notes) descParts.push(event.notes);
  if (event.status === 'tentative') descParts.push('⚠️ TENTATIVE — pending confirmation');
  if (descParts.length > 0) {
    lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
};

Deno.serve(async (req) => {
  const functionName = "create-appointment";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { events: inputEvents = [] } = body;

    if (!inputEvents || inputEvents.length === 0) {
      return new Response(JSON.stringify({ created: [], error: 'No events provided' }), { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // 1. Get User
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
    });
    const user = await userRes.json();
    if (!user?.id) throw new Error("Unauthorized");

    // 2. Get Apple Credentials + Timezone
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=apple_id,apple_app_password,timezone`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const profiles = await profileRes.json();
    const profile = profiles[0];
    const userTimezone = profile?.timezone || 'Australia/Melbourne';

    if (!profile?.apple_id || !profile?.apple_app_password) {
      return new Response(JSON.stringify({ created: [], error: 'No Apple credentials configured. Add your Apple ID and app-specific password in Settings.' }), { headers: corsHeaders });
    }

    // 3. Discover CalDAV calendar (reuse logic from sync-apple-calendar)
    const auth = btoa(`${profile.apple_id}:${profile.apple_app_password}`);
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'text/xml; charset=utf-8',
      'User-Agent': 'VibeCal/1.0',
    };

    const baseUrl = 'https://caldav.icloud.com';
    const extractHref = (xml, tag) => {
      const regex = new RegExp(`<[^>]*${tag}[^>]*>\\s*<[^>]*href[^>]*>([^<]+)<\\/[^>]*href>\\s*<\\/[^>]*${tag}>`, 'i');
      return xml.match(regex)?.[1];
    };

    // Principal
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

    // Home set
    const homeRes = await fetch(principalUrl, {
      method: 'PROPFIND',
      headers: { ...headers, 'Depth': '0' },
      body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`
    });
    const homeText = await homeRes.text();
    let homePath = extractHref(homeText, 'calendar-home-set');
    const homeUrl = homePath.startsWith('http') ? homePath : `${baseUrl}${homePath}`;

    // Find enabled calendars — use the first enabled Apple calendar, or look for a default one
    const userCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.apple&is_enabled=eq.true`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const userCals = await userCalsRes.json();

    // If no enabled calendars, discover them and pick the first non-reminder one
    let targetCalendarUrl;
    let targetCalendarName;

    if (userCals && userCals.length > 0) {
      targetCalendarUrl = userCals[0].calendar_id;
      targetCalendarName = userCals[0].calendar_name;
    } else {
      // Discover calendars
      const calsRes = await fetch(homeUrl, {
        method: 'PROPFIND',
        headers: { ...headers, 'Depth': '1' },
        body: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>`
      });
      const calsText = await calsRes.text();
      const responses = calsText.split(/<[^:]*:?response/i).slice(1);
      for (const resp of responses) {
        const href = resp.match(/<[^:]*:?href[^>]*>([^<]+)<\/[^:]*:?href>/i)?.[1];
        const name = resp.match(/<[^:]*:?displayname[^>]*>([^<]+)<\/[^:]*:?displayname>/i)?.[1];
        const isCalendar = /resourcetype[^>]*>.*?calendar/is.test(resp);
        if (href && isCalendar && name && !name.toLowerCase().includes('reminders') && !name.includes('@')) {
          targetCalendarUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
          targetCalendarName = name;
          break;
        }
      }
    }

    if (!targetCalendarUrl) {
      return new Response(JSON.stringify({ created: [], error: 'No Apple calendar found. Make sure your Apple ID and app-specific password are set in Settings.' }), { headers: corsHeaders });
    }

    console.log(`[${functionName}] Creating ${inputEvents.length} events in calendar: ${targetCalendarName}`);

    // 4. Create each event via CalDAV PUT
    const created = [];

    for (const event of inputEvents) {
      const uid = generateUID();
      const ics = buildVEVENT(event, uid, userTimezone);
      const eventUrl = `${targetCalendarUrl}/${uid}.ics`;

      console.log(`[${functionName}] PUT ${eventUrl}`);

      const createRes = await fetch(eventUrl, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*',
        },
        body: ics,
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error(`[${functionName}] CalDAV PUT failed for "${event.title}": ${createRes.status} ${errText}`);
        created.push({ title: event.title, success: false, error: `CalDAV error: ${createRes.status}` });
        continue;
      }

      // Cache the event in Supabase
      const startMs = new Date(event.startDateTime).getTime();
      const endMs = new Date(event.endDateTime).getTime();
      const durationMinutes = Math.round((endMs - startMs) / 60000);

      const cacheEntry = {
        user_id: user.id,
        event_id: uid,
        title: event.title,
        start_time: new Date(event.startDateTime).toISOString(),
        end_time: new Date(event.endDateTime).toISOString(),
        duration_minutes: durationMinutes,
        provider: 'apple',
        source_calendar: targetCalendarName,
        source_calendar_id: targetCalendarUrl,
        last_synced_at: new Date().toISOString(),
      };

      await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify([cacheEntry]),
      });

      created.push({ title: event.title, success: true, uid, event_id: uid });
    }

    const successCount = created.filter(c => c.success).length;
    console.log(`[${functionName}] Created ${successCount}/${inputEvents.length} events`);

    return new Response(JSON.stringify({ created, successCount, total: inputEvents.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal:`, error.message);
    return new Response(JSON.stringify({ created: [], error: error.message }), { status: 400, headers: corsHeaders });
  }
});
