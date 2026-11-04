/**
 * The phone screens for the current machine (PAN-4837 FR-8, D-9). `MobileApp` runs unchanged; the
 * channel shims carry its requests. The query client mirrors the frontend's `main.tsx` options. The
 * frontend's boot-time settings and theme reconciles and telemetry are not run: they read admin
 * routes (PAN-4835 H-4).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ImageLightboxHost } from '../../../../src/dashboard/frontend/src/components/chat/ImageLightbox';
import { DialogProvider } from '../../../../src/dashboard/frontend/src/components/DialogProvider';
import MobileApp from '../../../../src/dashboard/frontend/src/components/mobile/MobileApp';
import { installQueryRecovery } from '../../../../src/dashboard/frontend/src/lib/queryRecovery';
import { UpdatingBanner } from './UpdatingBanner';

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed');
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: 60_000,
        staleTime: 30_000,
        refetchIntervalInBackground: false,
        retry: (failureCount, error) => isNetworkError(error) && failureCount < 3,
      },
      mutations: {
        retry: (failureCount, error) => isNetworkError(error) && failureCount < 3,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
      },
    },
  });
}

interface MachineViewProps {
  label: string;
  /** The header control: back to the machine list. */
  onMachines(): void;
}

export function MachineView({ label, onMachines }: MachineViewProps) {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => installQueryRecovery(queryClient), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <MobileApp
          headerSlot={
            <button type="button" onClick={onMachines} className="min-h-11 px-2 text-sm font-medium text-foreground">
              {label} ▾
            </button>
          }
        />
        <ImageLightboxHost />
        <UpdatingBanner />
      </DialogProvider>
    </QueryClientProvider>
  );
}
