

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Carpeta estándar de compilación para Vercel y Next.js.
  // Corrige el error: The Next.js output directory ".next" was not found.
  distDir: '.next',

  // Configuración de ESLint.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Verificación de TypeScript durante la compilación.
  typescript: {
    ignoreBuildErrors: false,
  },

  // Configuración de imágenes externas autorizadas.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.simpleicons.org',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.baccredomatic.com',
        pathname: '/**',
      },
    ],
  },

  // Paquetes que Next.js debe transpilar.
  transpilePackages: ['motion'],

  // Encabezados HTTP de seguridad.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'no-referrer',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },

  // Configuración de Webpack.
  webpack: (config, { dev }) => {
    // Desactivar Hot Module Replacement cuando sea necesario.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    return config;
  },
};

export default nextConfig;
