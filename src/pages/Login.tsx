"use client";

import React from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';

const Login = () => {
  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        // Requesting permission to read/write calendar events
        scopes: 'https://www.googleapis.com/auth/calendar.events'
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC] p-4">
      <Card className="w-full max-md border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-white">
        <CardHeader className="bg-indigo-600 text-white text-center pt-12 pb-10">
          <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-6 backdrop-blur-sm">
            <Calendar size={40} />
          </div>
          <CardTitle className="text-3xl font-black tracking-tight">VibeCal</CardTitle>
          <CardDescription className="text-indigo-100 text-lg mt-2">
            Align your schedule with your life.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10">
          <div className="space-y-6">
            <Button 
              onClick={handleGoogleLogin}
              className="w-full py-8 rounded-2xl bg-white border-2 border-gray-100 text-gray-700 hover:bg-gray-50 hover:border-indigo-100 transition-all flex items-center justify-center gap-4 shadow-sm group"
            >
              <svg className="w-6 h-6 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span className="text-lg font-bold">Continue with Google</span>
            </Button>
            
            <p className="text-center text-sm text-gray-400 font-medium px-4">
              By continuing, you agree to allow VibeCal to manage your calendar events for optimisation.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;