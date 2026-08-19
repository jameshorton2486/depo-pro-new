export const LOCAL_API_BASE_URL = "http://127.0.0.1:4317";

export class LocalApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "LocalApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_API_BASE_URL}${path}`, init);
  const payload = await response.json().catch(() => ({})) as { error?:string; code?:string } & T;
  if (!response.ok) throw new LocalApiError(payload.error || `Local service returned HTTP ${response.status}.`, response.status, payload.code || null);
  return payload;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiJson<T>(path, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(body) });
}
