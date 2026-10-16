import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // This app sits inside a larger repo, and lockfiles further up the tree
    // would otherwise make Turbopack infer a workspace root outside the project.
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
