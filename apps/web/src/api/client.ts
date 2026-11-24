export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiError extends Error {
  status?: number
  code?: string
}

export class ApiClient {
  protected baseUrl: string
  protected isProduction: boolean

  constructor(baseUrl = '', isProduction = false) {
    this.baseUrl = baseUrl
    this.isProduction = isProduction
  }

  protected async request<T>(
    path: string,
    { method = 'GET', body, headers }: { method?: HttpMethod; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = this.baseUrl + path
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = new Error(`API error ${res.status}: ${res.statusText}`) as ApiError
      err.status = res.status
      try {
        const body = await res.json()
        err.code = body?.code
        err.message = body?.error ?? err.message
      } catch {
        // ignore non-json error bodies
      }
      throw err
    }
    if (res.status === 204) return undefined as T
    return res.json()
  }
}
