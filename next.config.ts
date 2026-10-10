import type { NextConfig } from 'next';

const config: NextConfig = {
  // Prompts are read from /prompts at runtime; make sure they ship with the server functions.
  outputFileTracingIncludes: { '/**': ['./prompts/**'] },
};

export default config;
