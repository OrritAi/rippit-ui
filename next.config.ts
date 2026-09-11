import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Legacy platform-specific routes → unified /w/[provider]/[id]
    return [
      {
        source: "/scenarios/:id",
        destination: "/w/make/:id",
        permanent: false,
      },
      {
        source: "/workflows/ghl/:id",
        destination: "/w/ghl/:id",
        permanent: false,
      },
      // v2 shell: the unified map lives at /map (query string carries over)
      {
        source: "/unified",
        destination: "/map",
        permanent: false,
      },
      // Funnels became Martech; API paths still say /funnels.
      {
        source: "/funnels",
        destination: "/martech",
        permanent: false,
      },
      {
        source: "/funnels/:id",
        destination: "/martech/:id",
        permanent: false,
      },
      // Records became the Triage home; `?q=` carries over.
      {
        source: "/records",
        destination: "/triage",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
