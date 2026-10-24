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
  // Next's own badge, shown by next dev only, has no free corner: it sat on
  // top of LaunchDarkly's developer toolbar bottom-left, the swag assistant
  // has bottom-right, and top-right covers Under the hood's close button.
  // Build errors still open Next's overlay without it.
  devIndicators: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

module.exports = nextConfig;
