"use client";

import { useClientReady } from "./use-client-ready";

import { themePreference, type Theme } from "./theme-preference";

export function ThemePicker({ initial }: { initial: Theme }) {
  const ready = useClientReady();
  return <label className="theme-picker">
    <span>Appearance</span>
    <select disabled={!ready} defaultValue={initial} onChange={event => {
      const theme = themePreference(event.currentTarget.value);
      document.documentElement.dataset.theme = theme;
      document.cookie = `nexus_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </label>;
}
