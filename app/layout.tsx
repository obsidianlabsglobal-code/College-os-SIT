import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "NEXUS · College OS", description: "Assignments and feedback for higher education." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip" href="#main">Skip to content</a>{children}</body></html>;
}
