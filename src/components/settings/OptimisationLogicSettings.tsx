"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield } from 'lucide-react';

interface OptimisationLogicSettingsProps {
  settings: any;
  setSettings: (settings: any) => void;
}

const OptimisationLogicSettings = ({ settings, setSettings }: OptimisationLogicSettingsProps) => {
  return (
    <Card className="border-none shadow-sm rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="text-indigo-600" size={20} />
          Optimisation Logic
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Aggressiveness</Label>
          <Select 
            value={settings.optimisation_aggressiveness}
            onValueChange={(val) => setSettings({...settings, optimisation_aggressiveness: val})}
          >
            <SelectTrigger className="rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relaxed">Relaxed (Keep most)</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="strict">Strict (Aggressive moves)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Preview Mode</Label>
            <p className="text-xs text-gray-500">Review changes before syncing</p>
          </div>
          <Switch 
            checked={settings.preview_mode_enabled}
            onCheckedChange={(val) => setSettings({...settings, preview_mode_enabled: val})}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Group Similar Tasks</Label>
            <p className="text-xs text-gray-500">Minimise context switching</p>
          </div>
          <Switch 
            checked={settings.group_similar_tasks}
            onCheckedChange={(val) => setSettings({...settings, group_similar_tasks: val})}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default OptimisationLogicSettings;