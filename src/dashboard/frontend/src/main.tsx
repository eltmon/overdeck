import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogProvider } from './components/DialogProvider';
import App from './App';
import './index.css';

/**
 * Retry on transient network errors (PAN-207: ERR_NETWORK_CHANGED)
 *
 * Docker network operations during workspace/container creation can
 * briefly disrupt browser TCP connections. Retry automatically.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed');
  }
  return false;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 60_000,      // 60s fallback poll (WebSocket RPC handles real-time)
      staleTime: 30_000,            // Data considered fresh for 30s
      refetchIntervalInBackground: false, // Don't poll when tab is hidden
      retry: (failureCount, error) => isNetworkError(error) && failureCount < 3,
    },
    mutations: {
      retry: (failureCount, error) => isNetworkError(error) && failureCount < 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <App />
      </DialogProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
