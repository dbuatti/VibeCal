// @ts-nocheck
// Creates a cal.com date override marking a day as UNAVAILABLE (day off).
// Uses cal.com v2 API (v1 decommissioned April 2026).
// Also saves to day_status table for local cache.
// Requires CAL_COM_API_KEY and CAL_COM_SCHEDULE_ID env vars (set via supabase secrets).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CAL_API_VERSION = '2024-06-11';
const CAL_BASE_URL = 'https://api.cal.com/v2';

Deno.serve(async (req) => {
  const functionName = "block-day";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const calApiKey = Deno.env.get('CAL_COM_API_KEY');
    const scheduleId = Deno.env.get('CAL_COM_SCHEDULE_ID');

    const { date, blocked } = await req.json();
    if (!date) throw new Error('Missing date parameter');

    // 1. Get user
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const userRes = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const user = userRes.data.user;
    if (!user?.id) throw new Error("Unauthorized");

    console.log(`[${functionName}] Blocking date ${date} for user ${user.id}, blocked=${blocked}`);

    // 2. Upsert to day_status table FIRST (always persists regardless of cal.com result)
    const { error: upsertError } = await supabase
      .from('day_status')
      .upsert(
        { user_id: user.id, date, is_blocked: blocked },
        { onConflict: 'user_id,date' }
      );

    if (upsertError) {
      console.error(`[${functionName}] Failed to upsert day_status:`, upsertError.message);
      throw upsertError;
    }
    console.log(`[${functionName}] day_status upserted: ${date} blocked=${blocked}`);

    // 3. Call cal.com v2 API to set date override
    if (calApiKey && scheduleId) {
      const calHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${calApiKey}`,
        'cal-api-version': CAL_API_VERSION,
      };

      try {
        console.log(`[${functionName}] Fetching cal.com v2 schedule ${scheduleId}`);
        const getRes = await fetch(
          `${CAL_BASE_URL}/schedules/${scheduleId}`,
          { headers: calHeaders }
        );

        if (!getRes.ok) {
          const errText = await getRes.text();
          throw new Error(`GET schedule failed (${getRes.status}): ${errText}`);
        }

        const getBody = await getRes.json();
        const schedule = getBody.data;
        if (!schedule) throw new Error('No schedule data in v2 response');

        const overrideDate = date; // already yyyy-MM-dd
        let overrides = schedule.overrides || [];

        if (blocked) {
          overrides = overrides.filter((o: any) => o.date?.split('T')[0] !== overrideDate);
          overrides.push({ date: overrideDate, startTime: '00:00', endTime: '00:00' });
        } else {
          overrides = overrides.filter((o: any) => o.date?.split('T')[0] !== overrideDate);
        }

        console.log(`[${functionName}] Patching cal.com v2 schedule with ${overrides.length} overrides`);
        const patchRes = await fetch(
          `${CAL_BASE_URL}/schedules/${scheduleId}`,
          {
            method: 'PATCH',
            headers: calHeaders,
            body: JSON.stringify({
              timeZone: schedule.timeZone,
              availability: schedule.availability || [],
              overrides,
            }),
          }
        );

        if (!patchRes.ok) {
          const patchError = await patchRes.text();
          console.error(`[${functionName}] cal.com v2 API error (${patchRes.status}): ${patchError}`);
          return new Response(JSON.stringify({
            success: true, date, blocked,
            cal_com_error: `HTTP ${patchRes.status}: ${patchError}`
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        console.log(`[${functionName}] cal.com v2 schedule updated successfully`);
      } catch (calErr) {
        console.error(`[${functionName}] cal.com v2 API call failed:`, (calErr as Error).message);
        return new Response(JSON.stringify({
          success: true, date, blocked,
          cal_com_error: (calErr as Error).message
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      console.log(`[${functionName}] CAL_COM_API_KEY or CAL_COM_SCHEDULE_ID not set, skipping cal.com`);
    }

    return new Response(JSON.stringify({ success: true, date, blocked }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 400, headers: corsHeaders });
  }
});
