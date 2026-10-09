export interface ServerConfig {
  metaAccessToken: string;
  threadsAccessToken?: string;
}

export function loadConfig(): ServerConfig {
  return {
    metaAccessToken: process.env.META_ACCESS_TOKEN?.trim() ?? "",
    threadsAccessToken: process.env.THREADS_ACCESS_TOKEN?.trim() || undefined,
  };
}
