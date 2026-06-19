import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import Index from "./pages/Index";
import Energy from "./pages/Energy";
import Optimise from "./pages/Optimise";
import Settings from "./pages/Settings";
import History from "./pages/History";
import Login from "./pages/Login";
import Plan from "./pages/Plan";
import Vet from "./pages/Vet";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFDFF]">
      <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="w-20 h-20 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-lg shadow-indigo-100">
          <svg viewBox="0 0 24 24" className="w-10 h-10 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">VibeCal</h1>
          <p className="text-gray-400 font-medium text-sm">Loading your schedule...</p>
        </div>
        <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden mx-auto">
          <div className="h-full bg-indigo-600 rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    </div>
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter 
          future={{ 
            v7_startTransition: true,
            v7_relativeSplatPath: true 
          }}
        >
          <Routes>
            <Route path="/login" element={!session ? <Login /> : <Navigate to="/" replace />} />
            <Route path="/" element={session ? <Energy /> : <Navigate to="/login" replace />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/energy" element={<Navigate to="/" replace />} />
            <Route path="/optimise" element={session ? <Optimise /> : <Navigate to="/login" replace />} />
            <Route path="/plan" element={session ? <Plan /> : <Navigate to="/login" replace />} />
            <Route path="/vet" element={session ? <Vet /> : <Navigate to="/login" replace />} />
            <Route path="/history" element={session ? <History /> : <Navigate to="/login" replace />} />
            <Route path="/settings" element={session ? <Settings /> : <Navigate to="/login" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;