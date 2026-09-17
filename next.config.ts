import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * `next dev` takes a lock on its build directory, so one checkout can only
   * run one dev server — which is a problem when a geometry or screenshot run
   * needs a server configured differently from the one already up (a snapshot
   * directory, say). Pointing this elsewhere gives that run its own build dir
   * and its own lock:
   *
   *   NEXT_DIST_DIR=.next-check PORT=3111 npm run dev
   *
   * Unset, which is every normal case, it is exactly `.next` as before.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
