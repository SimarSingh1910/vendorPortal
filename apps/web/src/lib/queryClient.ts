import { QueryClient } from '@tanstack/react-query';

/** Shared React Query client. Tune defaults conservatively for a data-heavy admin app. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
