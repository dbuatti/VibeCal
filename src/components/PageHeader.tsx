"use client";

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  className?: string;
}

const PageHeader = ({
  title,
  subtitle,
  icon: Icon,
  iconClassName,
  actions,
  breadcrumbs,
  className
}: PageHeaderProps) => {
  return (
    <div className={cn("flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6", className)}>
      <div className="space-y-1">
        {breadcrumbs && (
          <div className="mb-4">
            {breadcrumbs}
          </div>
        )}
        <div className="flex items-center gap-3">
          {Icon && (
            <div className={cn("w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm", iconClassName)}>
              <Icon size={22} />
            </div>
          )}
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">{title}</h1>
        </div>
        {subtitle && (
          <p className="text-gray-500 font-medium text-lg pl-1">{subtitle}</p>
        )}
      </div>
      
      {actions && (
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {actions}
        </div>
      )}
    </div>
  );
};

export default PageHeader;