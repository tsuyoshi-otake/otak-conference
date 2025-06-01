declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production';
      CLOUDFLARE_WORKER_DOMAIN: string;
      REACT_APP_COMMIT_HASH?: string;
    }
  }
}

export {};