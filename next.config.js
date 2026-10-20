/** @type {import('next').NextConfig} */
const { version } = require('./package.json');

const nextConfig = {
  // These three mirror ld-core-demo so ported components behave the same.
  reactStrictMode: false,
  output: 'standalone',
  productionBrowserSourceMaps: true,
  // Left as a real package in node_modules rather than bundled, because
  // LangChain imports it by name at runtime (see lib/aiServer.ts) and a
  // bundled copy is not somewhere that import can find.
  serverExternalPackages: ['@langchain/aws'],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

module.exports = nextConfig;
