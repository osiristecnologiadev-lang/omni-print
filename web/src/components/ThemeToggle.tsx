'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'omniprint-theme';

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing / storage disabled - the choice just won't persist
    // across reloads, still applies for this page view.
  }
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M8 1.5v1.3M8 13.2v1.3M14.5 8h-1.3M2.8 8H1.5M12.5 3.5l-.9.9M4.4 11.6l-.9.9M12.5 12.5l-.9-.9M4.4 4.4l-.9-.9"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5a5.8 5.8 0 1 0 7.7 7.7Z"
      />
    </svg>
  );
}

// Explicit light/dark choice, on top of the prefers-color-scheme default
// (see globals.css's three-tier token comment) - a beforeInteractive script
// in the root layout applies any stored choice before first paint, so this
// component's own mount effect is just for picking up the *current* value
// to highlight, not for avoiding a flash (that's already handled).
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    if (stored === 'light' || stored === 'dark') {
      setThemeState(stored);
    } else {
      setThemeState(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }, []);

  function choose(next: Theme) {
    setThemeState(next);
    applyTheme(next);
  }

  const optionClass = (active: boolean) =>
    `flex items-center justify-center rounded-full p-1.5 transition-colors ${
      active ? 'bg-surface text-ink shadow-sm shadow-ink/10' : 'text-ink-faint hover:text-ink-muted'
    }`;

  return (
    <div
      className="flex items-center rounded-full border border-line bg-surface-2 p-0.5"
      style={{ visibility: theme ? 'visible' : 'hidden' }}
    >
      <button type="button" onClick={() => choose('light')} aria-pressed={theme === 'light'} aria-label="Tema claro" className={optionClass(theme === 'light')}>
        <SunIcon />
      </button>
      <button type="button" onClick={() => choose('dark')} aria-pressed={theme === 'dark'} aria-label="Tema escuro" className={optionClass(theme === 'dark')}>
        <MoonIcon />
      </button>
    </div>
  );
}
