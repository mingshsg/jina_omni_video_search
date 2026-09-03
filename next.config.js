/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Smaller Docker runtime image (copies .next/standalone)
  output: 'standalone',
  // EUI ships untranspiled ESM that needs Next's compiler
  transpilePackages: [
    '@elastic/eui',
    '@elastic/eui-theme-borealis',
    '@emotion/react',
    '@emotion/css',
  ],
};

module.exports = nextConfig;
