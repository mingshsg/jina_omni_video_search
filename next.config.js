/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Smaller Docker runtime image (copies .next/standalone)
  output: 'standalone',
  // The app never uses next/image; disable the built-in optimizer route
  // (/_next/image) rather than leave it reachable by default. next@14.2.35
  // is the final 14.x release and carries an unauthenticated RCE in that
  // route (GHSA — Image Optimization API) with no 14.x patch — see
  // reviews/project-level-review-2026-09-23.md X1. Revisit when the project
  // migrates to Next >=15.5.24.
  images: {
    unoptimized: true,
  },
  // EUI ships untranspiled ESM that needs Next's compiler
  transpilePackages: [
    '@elastic/eui',
    '@elastic/eui-theme-borealis',
    '@emotion/react',
    '@emotion/css',
  ],
};

module.exports = nextConfig;
