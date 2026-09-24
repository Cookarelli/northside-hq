'use client';
import {createContext, useContext, type ReactNode} from 'react';
import {createPortal} from 'react-dom';

export const HqPageActionsContext = createContext<HTMLDivElement | null>(null);

// Keep actions beside the single page title without moving their workflow state.
export function HqPageActions({children}: {children: ReactNode}) {
  const target = useContext(HqPageActionsContext);
  return target ? createPortal(children, target) : <div className="hq-page-actions">{children}</div>;
}
