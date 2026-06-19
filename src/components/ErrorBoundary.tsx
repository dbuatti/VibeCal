import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FDFDFF]">
          <div className="text-center space-y-6 max-w-md mx-auto p-8">
            <div className="w-20 h-20 bg-red-50 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-lg shadow-red-100">
              <AlertTriangle className="w-10 h-10 text-red-500" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                Something went wrong
              </h1>
              <p className="text-gray-400 font-medium text-sm">
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
            </div>
            <Button
              onClick={this.handleRetry}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-8 h-12 font-black text-xs uppercase tracking-widest"
            >
              <RefreshCw size={16} className="mr-2" /> Try Again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
