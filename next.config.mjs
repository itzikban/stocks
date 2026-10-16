/** @type {import('next').NextConfig} */
const nextConfig = {
  // data.json (written by the GitHub Action) is read from disk as a fallback.
  outputFileTracingIncludes: { "/**": ["./data.json"] },
};
export default nextConfig;
