import React from 'react';
import FloatingMenu from './FloatingMenu';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  hideSidebar?: boolean; // Kept for prop compatibility but ignored
}

const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="min-h-screen bg-[#F8F9FC] selection:bg-indigo-100 selection:text-indigo-900">
      <main className="min-h-screen transition-all duration-500 ease-in-out">
        <div className="mx-auto p-4 md:p-8 max-w-7xl">
          {children}
        </div>
      </main>
      <FloatingMenu />
    </div>
  );
};

export default Layout;