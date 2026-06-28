import type { NextConfig } from "next";

// Statyczny export — panel to czysty client-side SPA (brak SSR/API), więc
// generujemy pliki do `out/` i serwujemy z Firebase Hosting (CDN, darmowo).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
