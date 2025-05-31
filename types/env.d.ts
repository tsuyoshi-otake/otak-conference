declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
    CLOUDFLARE_WORKER_DOMAIN?: string;
    GIT_COMMIT_ID?: string;
  }
}