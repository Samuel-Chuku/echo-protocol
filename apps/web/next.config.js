/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace packages from source (no prebuilt dist needed). The SDK ships .ts +
  // JSON ABIs; Next compiles them directly.
  transpilePackages: ['@echo/sdk', '@echo/types'],
  webpack: (config) => {
    // Benign "Critical dependency: the request of a dependency is an expression" warnings come from
    // walletconnect→pino and viem→ox using dynamic require(expr). They don't affect runtime; silence
    // them so real warnings stay visible.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];
    return config;
  },
};

module.exports = nextConfig;
