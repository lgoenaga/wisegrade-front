import { API_BASE_URL } from './config'

export type ApiError = {
  status: number
  message: string
  raw?: unknown
}

async function readJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function apiPostJson<TResponse>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const raw = await readJsonSafe(response)
    const message =
      typeof raw === 'object' && raw && 'message' in raw
        ? String((raw as any).message)
        : `HTTP ${response.status}`

    const err: ApiError = { status: response.status, message, raw }
    throw err
  }

  return (await readJsonSafe(response)) as TResponse
}

export async function apiGetJson<TResponse>(
  path: string,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    const raw = await readJsonSafe(response)
    const message =
      typeof raw === 'object' && raw && 'message' in raw
        ? String((raw as any).message)
        : `HTTP ${response.status}`

    const err: ApiError = { status: response.status, message, raw }
    throw err
  }

  return (await readJsonSafe(response)) as TResponse
}
