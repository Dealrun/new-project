import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite(로컬용 내장 Postgres)는 WASM 파일을 쓰므로 번들에서 제외한다.
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
