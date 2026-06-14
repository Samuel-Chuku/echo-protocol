/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace packages from source (no prebuilt dist needed). The SDK ships .ts +
  // JSON ABIs; Next compiles them directly.
  transpilePackages: ['@echo/sdk', '@echo/types'],
};

module.exports = nextConfig;
