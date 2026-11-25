"use client";

import { themePreference, type Theme } from "./theme-preference";

export function ThemePicker({ initial }: { initial: Theme }) {
  return <label className="theme-picker">
    <span>Appearance</span>
    <select defaultValue={initial} onChange={event => {
      const theme = themePreference(event.currentTarget.value);
      document.documentElement.dataset.theme = theme;
      document.cookie = `nexus_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </label>;
}
