import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // User source is persistent object-store FUSE; generated compiler output belongs
  // on the sandbox's fast local disk. The managed preview owns this relative path.
  distDir: process.env["CHEATCODE_NEXT_DIST_DIR"] ?? ".next",
};

export default nextConfig;
