import React from 'react';
import FloatingMenu from './FloatingMenu';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  hideSidebar?: boolean;
}

const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="min-h-screen bg-[#F8F9FC] selection:bg-indigo-100 selection:text-indigo-900 relative overflow-x-hidden">
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
        style={{ backgroundImage: 'radial-gradient(#4F46E5 1px, transparent 1px)', backgroundSize: '40px 40px' }} 
      />
      
      <main className="min-h-screen transition-all duration-500 ease-in-out relative z-10">
        <div className="mx-auto p-4 md:p-8 max-w-5xl animate-in fade-in slide-in-from-bottom-2 duration-700">
          {children}
        </div>
      </main>
      <FloatingMenu />
    </div>
  );
};

export default Layout;