import type { MetadataRoute } from "next";

// Installable app shell for phones. Records are never cached; see public/sw.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXUS College OS",
    short_name: "NEXUS",
    description: "Your college day: classes, work, requests and the bus.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f9f7f3",
    theme_color: "#6e54b7",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
