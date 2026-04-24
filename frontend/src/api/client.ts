type FetchOpts = RequestInit & { token?: string | null }

export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}

export async function api<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers)
  headers.set('content-type', 'application/json')
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)

  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) {
    const body = await res.text()
    let detail = body
    try {
      detail = JSON.parse(body).detail ?? body
    } catch {
      /* keep text */
    }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}
