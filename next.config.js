/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  compress: true, // Enable gzip compression
  images: {
    domains: ['localhost'],
    formats: ['image/avif', 'image/webp'], // Modern image formats
  },
  // Optimize production builds
  swcMinify: true, // Use SWC minifier (faster than Terser)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'], // Keep errors and warnings
    } : false,
  },
  webpack: (config, { isServer, dev }) => {
    // Only configure for client-side
    if (!isServer) {
      config.module.rules.push({
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource',
      });
      
      // Optimize bundle size
      if (!dev) {
        config.optimization = {
          ...config.optimization,
          moduleIds: 'deterministic',
          runtimeChunk: 'single',
          splitChunks: {
            chunks: 'all',
            cacheGroups: {
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendors',
                priority: 10,
                reuseExistingChunk: true,
              },
              leaflet: {
                test: /[\\/]node_modules[\\/](leaflet|@types\/leaflet)[\\/]/,
                name: 'leaflet',
                priority: 20,
                reuseExistingChunk: true,
              },
              chartjs: {
                test: /[\\/]node_modules[\\/](chart\.js|react-chartjs-2)[\\/]/,
                name: 'chartjs',
                priority: 20,
                reuseExistingChunk: true,
              },
            },
          },
        };
      }
    }
    return config;
  },
}

module.exports = nextConfig

