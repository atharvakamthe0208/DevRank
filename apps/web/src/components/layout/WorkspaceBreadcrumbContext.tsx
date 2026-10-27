import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useLocation } from 'react-router-dom';

export type WorkspaceBreadcrumbLabels = { pathname: string; candidateName?: string; evaluationName?: string };
export const WorkspaceBreadcrumbContext = createContext<Dispatch<SetStateAction<WorkspaceBreadcrumbLabels | null>> | null>(null);

export function useWorkspaceBreadcrumbLabels(labels: Omit<WorkspaceBreadcrumbLabels, 'pathname'>) {
  const setLabels = useContext(WorkspaceBreadcrumbContext);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!setLabels) return;
    setLabels({ pathname, ...labels });
    return () => setLabels((current) => current?.pathname === pathname ? null : current);
  }, [setLabels, pathname, labels.candidateName, labels.evaluationName]);
}
