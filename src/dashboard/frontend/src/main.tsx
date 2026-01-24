import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { RequestLockProvider, GlobalRequestIndicator } from './contexts/RequestLockContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 5000,
      staleTime: 2000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RequestLockProvider>
        <GlobalRequestIndicator />
        <App />
      </RequestLockProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
