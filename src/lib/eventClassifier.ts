// Client-side event-type classifier with heuristic fallback.
// The Energy page first tries the `classify-event-types` edge function (Gemini).
// If that function isn't deployed or errors, this heuristic classifier is used
// so the page works immediately.

export type AppointmentCategory =
  | 'buffer'
  | 'mtt'
  | 'performance'
  | 'fnh'
  | 'coaching'
  | 'workshop'
  | 'personal'
  | 'other';

export interface CategoryMeta {
  key: AppointmentCategory;
  label: string;
  color: string; // hex for recharts
  countsAsWork: boolean; // whether hours count toward "working hours"
}

export const CATEGORY_META: Record<AppointmentCategory, CategoryMeta> = {
  mtt: { key: 'mtt', label: 'MTT', color: '#7C3AED', countsAsWork: true },
  performance: { key: 'performance', label: 'Performance', color: '#E11D8E', countsAsWork: true },
  fnh: { key: 'fnh', label: 'FNH (Clinical)', color: '#0284C7', countsAsWork: true },
  coaching: { key: 'coaching', label: 'Voice / Piano Coaching', color: '#EA8A0C', countsAsWork: true },
  workshop: { key: 'workshop', label: 'Workshop / MTFest', color: '#059669', countsAsWork: true },
  other: { key: 'other', label: 'Other Work', color: '#64748B', countsAsWork: true },
  buffer: { key: 'buffer', label: 'Buffer / Recovery', color: '#D1D5DB', countsAsWork: false },
  personal: { key: 'personal', label: 'Personal', color: '#A78BFA', countsAsWork: false },
};

// Ordered for chart legend / stacking (work categories first, then non-work).
export const CATEGORY_ORDER: AppointmentCategory[] = [
  'mtt',
  'performance',
  'fnh',
  'coaching',
  'workshop',
  'other',
  'buffer',
  'personal',
];

const HEURISTICS: Array<{ category: AppointmentCategory; re: RegExp }> = [
  { category: 'buffer', re: /🚫|🔒|🌿|buffer|day off|rest|recovery|\bbreak\b/i },
  { category: 'fnh', re: /fnh|functional neuro|neuro.?health|peace framework|cranial|vestibular|primitive reflex|neuro assessment/i },
  { category: 'coaching', re: /voice|piano|coaching|singing|vocal|\blesson\b/i },
  { category: 'performance', re: /seussical|paw patrol|cabaret|carey|show|gig|concert|opening night|closing|tech rehears|dress rehears|performance|ceremony|cast call|cue to cue/i },
  { category: 'workshop', re: /mtfest|mt fest|workshop|masterclass|master class|seminar|\bintensive\b/i },
  { category: 'mtt', re: /\bmtt\b|melbourne theatre|pitch yourself/i },
  { category: 'personal', re: /lunch|dinner|brunch|coffee|gym|workout|\bwalk\b|meditate|yoga|haircut|doctor|dentist|affirmat|daily affirm|journal|grocer/i },
];

export const heuristicClassify = (title: string): { category: AppointmentCategory; confidence: number } => {
  for (const h of HEURISTICS) {
    if (h.re.test(title)) return { category: h.category, confidence: 0.8 };
  }
  return { category: 'other', confidence: 0.4 };
};

// Classify a list of events. Tries the edge function first, falls back to heuristics.
// Returns a map of event_id -> category.
export const classifyEventTypes = async (
  events: Array<{ event_id: string; title: string }>
): Promise<{ byEventId: Record<string, AppointmentCategory>; usedAI: boolean }> => {
  const byEventId: Record<string, AppointmentCategory> = {};
  if (events.length === 0) return { byEventId, usedAI: false };

  try {
    const { supabase } = await import('@/lib/supabase');
    const { data, error } = await supabase.functions.invoke('classify-event-types', {
      body: { events: events.map((e) => ({ event_id: e.event_id, title: e.title })), persist: true },
    });

    if (!error && data?.classifications && Array.isArray(data.classifications) && data.classifications.length === events.length) {
      events.forEach((e, i) => {
        const cat = data.classifications[i]?.category as AppointmentCategory;
        byEventId[e.event_id] = CATEGORY_META[cat] ? cat : 'other';
      });
      return { byEventId, usedAI: true };
    }
  } catch (e) {
    console.warn('[eventClassifier] edge function unavailable, using heuristics:', e);
  }

  events.forEach((e) => {
    byEventId[e.event_id] = heuristicClassify(e.title).category;
  });
  return { byEventId, usedAI: false };
};
