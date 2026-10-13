'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/wagmi';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { CircleResume } from '../wallet/CircleResume';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Arc makes a block about every half second; reads go stale fast but should not hammer the RPC.
        staleTime: 4_000,
        retry: 3,
        retryDelay: (n) => Math.min(500 * 2 ** n, 6_000),
        refetchOnWindowFocus: true,
      },
    },
  });
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="top-center"
      offset={16}
      mobileOffset={12}
      toastOptions={{
        classNames: {
          toast: '!rounded-[18px] !border-line !bg-surface !text-ink !shadow-card !font-sans',
          description: '!text-muted',
          actionButton: '!rounded-full !bg-ink !text-bg',
        },
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {children}
          <CircleResume />
          <ThemedToaster />
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
