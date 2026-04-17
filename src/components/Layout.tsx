import React from 'react';
import Navigation from './Navigation';

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen bg-[#F8F9FC]">
      <Navigation />
      <main className="pl-64 min-h-screen">
        <div className="max-w-6xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;