// @ts-nocheck
// Reads cal.com v2 schedule date overrides and syncs them to day_status table.
// This makes blocks created directly in cal.com reflect in the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CAL_API_VERSION = '2024-06-11';
const CAL_BASE_URL = 'https://api.cal.com/v2';

Deno.serve(async (req) => {
  const functionName = "sync-calendar-status";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const calApiKey = Deno.env.get('CAL_COM_API_KEY');
    const scheduleId = Deno.env.get('CAL_COM_SCHEDULE_ID');

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const userRes = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const user = userRes.data.user;
    if (!user?.id) throw new Error("Unauthorized");

    console.log(`[${functionName}] Syncing cal.com overrides for user ${user.id}`);

    if (!calApiKey || !scheduleId) {
      console.log(`[${functionName}] CAL_COM_API_KEY or CAL_COM_SCHEDULE_ID not set`);
      return new Response(JSON.stringify({ success: true, blockedDays: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch schedule from cal.com v2
    const calHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${calApiKey}`,
      'cal-api-version': CAL_API_VERSION,
    };

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

    const overrides = schedule.overrides || [];
    console.log(`[${functionName}] Found ${overrides.length} overrides in cal.com`);

    // An override with startTime "00:00" and endTime "00:00" means "Unavailable" (blocked)
    const blockedDays: string[] = [];
    for (const o of overrides) {
      if (o.startTime === '00:00' && o.endTime === '00:00') {
        const date = o.date?.split('T')[0];
        if (date) blockedDays.push(date);
      }
    }

    console.log(`[${functionName}] ${blockedDays.length} blocked days from cal.com`);

    // Upsert each blocked day to day_status, and unblock any that are in day_status but NOT in cal.com
    // Get existing blocked days
    const { data: existing } = await supabase
      .from('day_status')
      .select('date')
      .eq('user_id', user.id)
      .eq('is_blocked', true);

    const existingBlocked = new Set((existing || []).map((r: any) => r.date));

    // Days to block (in cal.com but not in day_status)
    const toBlock = blockedDays.filter(d => !existingBlocked.has(d));
    // Days to unblock (in day_status but not in cal.com)
    const toUnblock = [...existingBlocked].filter(d => !blockedDays.includes(d));

    console.log(`[${functionName}] To block: ${toBlock.length}, To unblock: ${toUnblock.length}`);

    for (const date of toBlock) {
      await supabase
        .from('day_status')
        .upsert({ user_id: user.id, date, is_blocked: true }, { onConflict: 'user_id,date' });
    }

    for (const date of toUnblock) {
      await supabase
        .from('day_status')
        .upsert({ user_id: user.id, date, is_blocked: false }, { onConflict: 'user_id,date' });
    }

    return new Response(JSON.stringify({ success: true, blockedDays }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 400, headers: corsHeaders });
  }
});
