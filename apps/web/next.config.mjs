/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };

    return webpackConfig;
  },
};
export default config;
