import { create } from 'zustand';

/**
 * UI-only client state (Zustand). Server state lives in React Query.
 * Kept minimal for the scaffold — currently just the sidebar toggle.
 */
interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
