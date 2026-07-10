import type { NextConfig } from "next";

// Next.js 15.2+ blocks non-localhost origins from /_next/* dev-internal
// resources by default. When the dashboard is accessed over Tailscale, a LAN
// IP, or a reverse proxy, the browser receives the SSR HTML but the client
// bundle cannot finish hydrating because dev-resource requests are rejected -
// useEffect never fires, the CSRF token is never fetched, and the login form
// is stuck.
//
// Set DASHBOARD_ALLOWED_DEV_ORIGINS to a comma-separated list of hostnames or
// IPs to whitelist (e.g. "100.64.95.40,mybox.local,dashboard.example.com").
// Localhost is always allowed. Only reads in development; production builds
// ignore the setting.
const allowedDevOrigins = (process.env.DASHBOARD_ALLOWED_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // F5 (pentest 2026-06-06): do not advertise the framework via X-Powered-By.
  poweredByHeader: false,
  ...(allowedDevOrigins.length > 0 && { allowedDevOrigins: Array.from(new Set(allowedDevOrigins)) }),
  async headers() {
    return [
      {
        // Prevent aggressive caching of API routes and pages through the tunnel
        source: '/((?!_next/static).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          // F2 (pentest 2026-06-06): baseline security headers. Low risk given
          // Tailscale-only access, but good practice - clickjacking (frame deny),
          // MIME-sniffing, and a restrictive feature policy.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
