"use client";

import React from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Calendar } from 'lucide-react';

const Login = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC] p-4">
      <Card className="w-full max-w-md border-none shadow-xl rounded-3xl overflow-hidden">
        <CardHeader className="bg-indigo-600 text-white text-center pb-8">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Calendar size={32} />
          </div>
          <CardTitle className="text-2xl font-bold">Welcome to VibeCal</CardTitle>
          <CardDescription className="text-indigo-100">
            Sign in to start optimising your schedule
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          <Auth
            supabaseClient={supabase}
            providers={['google']}
            queryParams={{
              access_type: 'offline',
              prompt: 'consent',
              // Requesting permission to read/write calendar events
              scopes: 'https://www.googleapis.com/auth/calendar.events'
            }}
            onlyThirdPartyProviders={true}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#4f46e5',
                    brandAccent: '#4338ca',
                  },
                  radii: {
                    borderRadiusButton: '12px',
                    inputBorderRadius: '12px',
                  }
                }
              }
            }}
            theme="light"
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;