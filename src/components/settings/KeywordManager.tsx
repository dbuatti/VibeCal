"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KeywordManagerProps {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  keywords: string[];
  onAdd: (keyword: string) => void;
  onRemove: (keyword: string) => void;
  placeholder?: string;
  badgeVariant?: "indigo" | "red" | "amber";
}

const KeywordManager = ({ 
  title, 
  icon: Icon, 
  iconColor, 
  keywords, 
  onAdd, 
  onRemove, 
  placeholder = "Add keyword...",
  badgeVariant = "indigo"
}: KeywordManagerProps) => {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    if (inputValue.trim()) {
      onAdd(inputValue.trim());
      setInputValue('');
    }
  };

  const badgeStyles = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    red: "bg-red-50 text-red-700 border-red-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100"
  };

  return (
    <Card className="border-none shadow-sm rounded-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={iconColor} size={18} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input 
            placeholder={placeholder} 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="rounded-xl h-9 text-xs"
          />
          <Button onClick={handleAdd} variant="secondary" size="sm" className="rounded-xl h-9">
            <Plus size={14} />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((kw) => (
            <Badge key={kw} variant="secondary" className={cn("px-2 py-1 rounded-lg text-[10px] flex items-center gap-1", badgeStyles[badgeVariant])}>
              {kw}
              <button onClick={() => onRemove(kw)} className="hover:opacity-70">
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default KeywordManager;