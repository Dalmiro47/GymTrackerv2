
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'placehold.co', pathname: '/**' }],
  },
  allowedDevOrigins: ['*.cloudworkstations.dev'],
  experimental: {},
};

// Export an async config so we can conditionally import in prod only.
export default async (): Promise<NextConfig> => {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    // Dev: NO PWA plugin, no webpack fields => Turbopack is happy
    return nextConfig;
  }

  // Prod: import and apply the PWA plugin
  const { default: withPWA } = await import('@ducanh2912/next-pwa');

  return withPWA({
    dest: 'public',
    register: true,
    skipWaiting: true,
    disable: false, // prod enabled
    workboxOptions: {
      runtimeCaching: [
        {
          urlPattern: ({ request }) =>
            ['style', 'script', 'worker', 'image', 'font'].includes(request.destination),
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'static-assets',
            expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
        {
          urlPattern: /^https?:\/\/[^/]+\/api\/.*$/i,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'api-cache',
            networkTimeoutSeconds: 5,
            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
          },
        },
        {
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'pages-cache',
            networkTimeoutSeconds: 5,
            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
          },
        },
      ],
    },
    fallbacks: { document: '/offline.html' },
  })(nextConfig);
};
