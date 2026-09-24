import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  // Keep the dev-mode route badge from sitting on top of the sidebar.
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client", "libsql"],
  // db/schema.sql + db/seed.sql are read at runtime to create an empty database.
  outputFileTracingIncludes: {
    "/**/*": ["./db/schema.sql", "./db/seed.sql"],
    "/": ["./db/schema.sql", "./db/seed.sql"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
