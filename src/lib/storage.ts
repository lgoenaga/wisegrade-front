export function loadString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function saveString(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function loadJson<T>(key: string): T | null {
  const raw = loadString(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    saveString(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export function remove(key: string): void {
  removeItem(key)
}
