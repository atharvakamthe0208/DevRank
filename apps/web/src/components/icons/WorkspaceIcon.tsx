import type { ReactNode } from 'react';

export type WorkspaceIconName = 'overview' | 'candidates' | 'evaluations' | 'insights' | 'screening' | 'completed' | 'average';

const iconShapes: Record<WorkspaceIconName, ReactNode> = {
  overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/></>,
  candidates: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20"/><circle cx="10" cy="7.5" r="3.5"/><path d="M16 4.3a3.5 3.5 0 0 1 0 6.8M20 20v-1.5a4 4 0 0 0-3-3.87"/></>,
  evaluations: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6M8.5 12l2.2 2.2 4.8-4.8"/></>,
  insights: <><path d="M4 19.5h16M5.5 16V12M10 16V8M14.5 16v-5M19 16V5"/><path d="m4.5 9 5-4 4.2 3 5.8-5"/></>,
  screening: <><path d="M6 3.5h8l4 4V14"/><path d="M14 3.5v4h4M6 3.5v17h6"/><circle cx="16.5" cy="16.5" r="3.5"/><path d="m19.2 19.2 2 2"/></>,
  completed: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  average: <><path d="M4 19.5h16M5.5 16v-4M10 16V8M14.5 16v-2M19 16V5"/></>,
};

export function WorkspaceIcon({ name, size = 18 }: { name: WorkspaceIconName; size?: number }) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{iconShapes[name]}</svg>;
}
