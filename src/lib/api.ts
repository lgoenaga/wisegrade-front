import { API_BASE_URL } from './config'

export type ApiError = {
  status: number
  message: string
  raw?: unknown
}

export type ApiBlobResponse = {
  blob: Blob
  filename?: string
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

function extractFilenameFromContentDisposition(value: string | null): string | undefined {
  if (!value) return undefined
  // Very small parser: supports `filename="..."`.
  const m = /filename\s*=\s*"([^"]+)"/i.exec(value)
  if (m?.[1]) return m[1]
  return undefined
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

export async function apiGetBlob(path: string, signal?: AbortSignal): Promise<ApiBlobResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    credentials: 'include',
    signal,
  })

  if (!response.ok) {
    const raw = await readJsonSafe(response)
    const message = extractMessage(raw, `HTTP ${response.status}`)

    const err: ApiError = { status: response.status, message, raw }
    throw err
  }

  const blob = await response.blob()
  const filename = extractFilenameFromContentDisposition(response.headers.get('content-disposition'))
  return { blob, filename }
}

export async function apiDelete(path: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
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
}

export async function apiPutJson<TResponse>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
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

export async function apiPut(path: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
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
}
