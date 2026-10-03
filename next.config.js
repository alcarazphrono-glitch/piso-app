/** @type {import('next').NextConfig} */

// CAPACITOR_BUILD=1 npm run build -> genera out/ (sitio estático) para
// empaquetarlo con Capacitor como app de iOS/Android. En Vercel se sigue
// construyendo normal.
const exportEstatico = process.env.CAPACITOR_BUILD === "1";

const nextConfig = {
  reactStrictMode: true,
  ...(exportEstatico
    ? { output: "export" }
    : {
        // Links viejos con /ciclo/<id> y /evento/<id> siguen funcionando.
        async redirects() {
          return [
            { source: "/ciclo/:id", destination: "/ciclo?id=:id", permanent: true },
            { source: "/evento/:id", destination: "/evento?id=:id", permanent: true },
          ];
        },
      }),
};

module.exports = nextConfig;
