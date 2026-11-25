export type Theme = "light" | "dark" | "system";
export function themePreference(value?: string): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
