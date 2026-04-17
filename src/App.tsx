import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Index from "./pages/Index";
import Optimise from "./pages/Optimise";
import Settings from "./pages/Settings";
import History from "./pages/History";
import Login from "./pages/Login";
import Plan from "./pages/Plan";
import Vet from "./pages/Vet";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  const [session, setSession] = useState<any>(null);
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

  if (loading) return null;

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
            <Route path="/" element={session ? <Index /> : <Navigate to="/login" replace />} />
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