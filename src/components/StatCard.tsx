import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent: 'indigo' | 'amber' | 'red' | 'green' | 'purple';
}

const ACCENTS: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  green: 'bg-green-50 text-green-600',
  purple: 'bg-purple-50 text-purple-600',
};

export default function StatCard({ icon: Icon, label, value, sub, accent }: StatCardProps) {
  return (
    <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', ACCENTS[accent])}>
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-tight">{label}</p>
          <div className="flex items-baseline gap-1">
            <h3 className="text-xl font-black text-gray-900 leading-none">{value}</h3>
            {sub && <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{sub}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
