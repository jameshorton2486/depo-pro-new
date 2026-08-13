interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

interface D1Database {
  readonly __depoProD1Brand?: "D1Database";
}

declare module "cloudflare:workers" {
  export const env: { DB?: D1Database };
}
