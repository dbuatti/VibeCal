"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Target } from 'lucide-react';

interface DayTheme {
  day_of_week: number;
  label: string;
  theme: string;
}

interface DayThemesSettingsProps {
  themes: DayTheme[];
  onThemeChange: (index: number, value: string) => void;
}

const DayThemesSettings = ({ themes, onThemeChange }: DayThemesSettingsProps) => {
  return (
    <Card className="border-none shadow-sm rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="text-indigo-600" size={20} />
          Day Themes
        </CardTitle>
        <CardDescription>
          Assign focus areas to specific days. The AI will try to match tasks to these themes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {themes.map((t, i) => (
          <div key={i} className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
            <span className="w-24 font-bold text-gray-500">{t.label}</span>
            <Input 
              placeholder="e.g. Music, Admin, Deep Work" 
              className="bg-white border-gray-200 rounded-xl"
              value={t.theme}
              onChange={(e) => onThemeChange(i, e.target.value)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default DayThemesSettings;