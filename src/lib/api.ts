import { API_BASE_URL } from './config'

export type ApiError = {
  status: number
  message: string
  raw?: unknown
}

function extractMessage(raw: unknown, fallback: string): string {
  if (!raw || typeof raw !== 'object') return fallback
  const msg = (raw as Record<string, unknown>).message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg == null) return fallback
  return String(msg)
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
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const raw = await readJsonSafe(response)
    const message = extractMessage(raw, `HTTP ${response.status}`)

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
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    const raw = await readJsonSafe(response)
    const message = extractMessage(raw, `HTTP ${response.status}`)

    const err: ApiError = { status: response.status, message, raw }
    throw err
  }

  return (await readJsonSafe(response)) as TResponse
}
