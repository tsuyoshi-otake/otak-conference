const { execSync } = require('child_process');
const fs = require('fs');
require('dotenv').config();

// Get commit hash
let commitHash = 'dev';
try {
  commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (error) {
  console.log('Could not get commit hash, using "dev"');
}

// Set environment variable and run build
process.env.REACT_APP_COMMIT_HASH = commitHash;

console.log(`Building with commit hash: ${commitHash}`);

// Run the build command
const buildCmd = `esbuild src/main.tsx --bundle --outfile=public/bundle.js --loader:.tsx=tsx --define:process.env.NODE_ENV=\\"production\\" --define:process.env.CLOUDFLARE_WORKER_DOMAIN=\\"${process.env.CLOUDFLARE_WORKER_DOMAIN || 'otak-conference-worker.systemexe-research-and-development.workers.dev'}\\" --define:process.env.REACT_APP_COMMIT_HASH=\\"${commitHash}\\" --define:process.env.GEMINI_API_KEY=\\"${process.env.GEMINI_API_KEY || ''}\\"`;

try {
  execSync(buildCmd, { stdio: 'inherit' });
  console.log(`Build completed successfully with commit hash: ${commitHash}`);
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
