"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AdminDashboardUiState {
  adminKey: string;
  pendingStatus: string;
  queueStatus: string;
  queueType: string;
  selectedQueueItemId: number | null;
  isLoading: boolean;
  error: string | null;
  actionError: string | null;
  actionQueueId: number | null;
  setAdminKey: (value: string) => void;
  setPendingStatus: (value: string) => void;
  setQueueStatus: (value: string) => void;
  setQueueType: (value: string) => void;
  setSelectedQueueItemId: (value: number | null) => void;
  setIsLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setActionError: (value: string | null) => void;
  setActionQueueId: (value: number | null) => void;
}

export const useAdminDashboardUiStore = create<AdminDashboardUiState>()(
  persist(
    (set) => ({
      adminKey: "",
      pendingStatus: "pending",
      queueStatus: "open",
      queueType: "all",
      selectedQueueItemId: null,
      isLoading: false,
      error: null,
      actionError: null,
      actionQueueId: null,
      setAdminKey: (value) => set({ adminKey: value }),
      setPendingStatus: (value) => set({ pendingStatus: value }),
      setQueueStatus: (value) => set({ queueStatus: value }),
      setQueueType: (value) => set({ queueType: value }),
      setSelectedQueueItemId: (value) => set({ selectedQueueItemId: value }),
      setIsLoading: (value) => set({ isLoading: value }),
      setError: (value) => set({ error: value }),
      setActionError: (value) => set({ actionError: value }),
      setActionQueueId: (value) => set({ actionQueueId: value }),
    }),
    {
      name: "ics-admin-dashboard-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        adminKey: state.adminKey,
        pendingStatus: state.pendingStatus,
        queueStatus: state.queueStatus,
        queueType: state.queueType,
      }),
    }
  )
);
