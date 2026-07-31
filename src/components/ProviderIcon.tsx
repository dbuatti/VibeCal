import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProviderIconProps {
  provider: string;
  size?: number;
}

const ProviderIcon = ({ provider, size = 12 }: ProviderIconProps) => {
  if (provider === 'google') {
    return (
      <svg viewBox="0 0 24 24" className="shrink-0" width={size} height={size}>
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    );
  }
  if (provider === 'apple') {
    return (
      <svg viewBox="0 0 24 24" className={cn('shrink-0', size <= 12 ? '' : 'text-gray-900')} width={size} height={size} fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05 1.61-3.22 1.61-1.14 0-1.55-.67-2.85-.67-1.32 0-1.77.65-2.85.67-1.15.02-2.19-.62-3.22-1.61C2.79 18.21 1.35 14.15 1.35 10.83c0-3.32 2.12-5.07 4.16-5.07 1.08 0 1.88.43 2.54.43.64 0 1.52-.47 2.75-.47 1.05 0 2.02.35 2.72.95 2.02 1.73 1.85 4.45 1.85 4.45s-2.35.85-2.35 3.5c0 2.65 2.35 3.5 2.35 3.5-.05.15-.32.65-.72 1.14zM12.03 4.95c-.02-1.3.5-2.55 1.35-3.45.85-.9 2.1-1.5 3.35-1.5.05 1.3-.45 2.55-1.35 3.45-.9.9-2.1 1.5-3.35 1.5z"/>
      </svg>
    );
  }
  return <Globe size={size} className="text-gray-400 shrink-0" />;
};

export default ProviderIcon;
