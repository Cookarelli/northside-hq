'use client';

import {useSyncExternalStore} from 'react';
import {usePathname} from 'next/navigation';
import {ThemeProvider as NextThemeProvider, useTheme} from 'next-themes';
import {Moon, Sun} from 'lucide-react';
import {hasWorkspaceHeader} from '@/lib/hq-navigation';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeToggle() {
  const {resolvedTheme, setTheme} = useTheme();
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const dark = mounted && resolvedTheme === 'dark';
  return <button className="theme-toggle" type="button" role="switch" aria-label="Dark mode"
      aria-checked={dark} disabled={!mounted} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Moon size={20} aria-hidden="true"/> : <Sun size={20} aria-hidden="true"/>}
      <span>{dark ? 'Dark mode' : 'Light mode'}</span>
      <span className="theme-switch-track" aria-hidden="true"><span/></span>
    </button>;
}

function AppearanceBar() {
  const pathname = usePathname();
  return hasWorkspaceHeader(pathname) ? null : <div className="appearance-bar"><ThemeToggle/></div>;
}

export function ThemeProvider({children}: {children: React.ReactNode}) {
  return <NextThemeProvider attribute="class" defaultTheme="light" enableSystem
    storageKey="northside-color-theme" disableTransitionOnChange>
    <AppearanceBar/>{children}
  </NextThemeProvider>;
}
