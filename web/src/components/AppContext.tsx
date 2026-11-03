'use client';
import { createContext, useContext } from 'react';
import type { Any } from '@/lib/client';

export interface AppState { me: Any; meta: Any; reloadMe: () => Promise<void> }

export const AppCtx = createContext<AppState | null>(null);

export function useApp() {
  const v = useContext(AppCtx);
  if (!v) throw new Error('AppCtx 밖에서 사용됨');
  return v;
}
