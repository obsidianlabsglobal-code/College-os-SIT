import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { themePreference } from "./experience/theme-preference";
import "./styles.css";

export const metadata: Metadata = {
  title: "NEXUS · College OS", description: "Assignments and feedback for higher education.",
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "NEXUS", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#6e54b7" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = themePreference((await cookies()).get("nexus_theme")?.value);
  return <html lang="en" data-theme={theme}><body><a className="skip" href="#main">Skip to content</a>{children}</body></html>;
}
