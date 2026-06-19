import React from 'react';
import FloatingMenu from './FloatingMenu';
import TopNav from './TopNav';
import Footer from './Footer';
import { useSyncCalendars } from '@/hooks/useSyncCalendars';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const { isSyncing, syncCalendars } = useSyncCalendars();

  const handleGlobalSync = async () => {
    await syncCalendars();
  };

  return (
    <div className="min-h-screen bg-[#FDFDFF] selection:bg-indigo-100 selection:text-indigo-900 relative overflow-x-hidden font-sans flex flex-col">
      {/* Dynamic Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-100/30 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute top-[20%] -right-[5%] w-[30%] h-[30%] bg-purple-100/20 blur-[100px] rounded-full" />
        <div className="absolute -bottom-[10%] left-[20%] w-[50%] h-[50%] bg-blue-50/40 blur-[150px] rounded-full" />

        {/* Subtle Grid */}
        <div className="absolute inset-0 opacity-[0.02]" 
          style={{ backgroundImage: 'radial-gradient(#4F46E5 0.5px, transparent 0.5px)', backgroundSize: '32px 32px' }} 
        />
      </div>

      <TopNav />

      <main className="flex-1 transition-all duration-700 ease-in-out relative z-10">
        <div className="mx-auto p-6 md:p-12 max-w-6xl animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {children}
        </div>
      </main>

      <Footer isSyncing={isSyncing} onSync={handleGlobalSync} />

      <FloatingMenu />
    </div>
  );
};

export default Layout;
