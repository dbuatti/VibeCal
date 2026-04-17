import React from 'react';
import Navigation from './Navigation';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  hideSidebar?: boolean;
}

const Layout = ({ children, hideSidebar = false }: LayoutProps) => {
  return (
    <div className="min-h-screen bg-[#F8F9FC]">
      {!hideSidebar && <Navigation />}
      <main className={cn(
        "min-h-screen transition-all duration-500 ease-in-out",
        hideSidebar ? "pl-0" : "pl-72"
      )}>
        <div className={cn(
          "mx-auto p-8 transition-all duration-500",
          hideSidebar ? "max-w-4xl" : "max-w-6xl"
        )}>
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;