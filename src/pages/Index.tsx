"use client";

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { RefreshCw } from 'lucide-react';

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to the visual planner as the main mode
    navigate('/plan', { replace: true });
  }, [navigate]);

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <RefreshCw className="animate-spin text-indigo-600 mb-4" size={32} />
        <p className="text-gray-500 font-bold animate-pulse">Loading your visual planner...</p>
      </div>
    </Layout>
  );
};

export default Index;