import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { ref, onValue, set } from 'firebase/database';
import { ACCENT_COLORS } from '../lib/accentColors';

const DEFAULT_SETTINGS = {
  autoplay: true,
  rememberProgress: true,
  resolution: 'auto',
  accentColor: 'mono',
  autoFetch: true,
  themeMode: 'dark',
  showBackground: true,
  shareToDiscover: true
};

export function useSettings(currentUser) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    if (!currentUser) {
      setSettings(DEFAULT_SETTINGS);
      return;
    }

    const settingsRef = ref(db, `users/${currentUser.uid}/settings`);
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    });

    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    const color = ACCENT_COLORS.find(c => c.name === settings.accentColor) || ACCENT_COLORS.find(c => c.name === 'mono');
    if (color) {
      document.documentElement.style.setProperty('--color-accent', color.value);
      document.documentElement.style.setProperty('--color-accent-muted', color.muted);
      document.documentElement.style.setProperty('--accent', color.value);
      document.documentElement.style.setProperty('--accent-muted', color.muted);
      localStorage.setItem('teraplay_accent', JSON.stringify(color));
    }
  }, [settings.accentColor]);

  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const apply = (theme) => {
      if (theme === 'system') {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', dark);
        root.classList.toggle('light', !dark);
        if (meta) meta.setAttribute('content', dark ? '#0a0a0f' : '#f7f8fa');
      } else {
        const dark = theme !== 'light';
        root.classList.toggle('dark', dark);
        root.classList.toggle('light', !dark);
        if (meta) meta.setAttribute('content', dark ? '#0a0a0f' : '#f7f8fa');
      }
    };
    apply(settings.themeMode || 'dark');
  }, [settings.themeMode]);

  const handleUpdateSettings = (newSettings) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    if (currentUser) {
      set(ref(db, `users/${currentUser.uid}/settings`), updated);
    }
  };

  const handleResetData = (onResetOtherData) => {
    if (currentUser) {
      set(ref(db, `users/${currentUser.uid}/settings`), DEFAULT_SETTINGS);
    }
    setSettings(DEFAULT_SETTINGS);
    if (onResetOtherData) onResetOtherData();
  };

  return { settings, handleUpdateSettings, handleResetData };
}
