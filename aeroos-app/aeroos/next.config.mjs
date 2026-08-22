/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma doit rester externe au bundle serveur. pdf-parse (+ ses
  // dépendances pdfjs-dist / @napi-rs/canvas) casse le bundling webpack
  // ("Object.defineProperty called on non-object") si on ne l'exclut pas.
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pdf-parse'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      ],
    }];
  },
};
export default nextConfig;
