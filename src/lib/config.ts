export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

export const EXAM_DURATION_MINUTES = Number(
  import.meta.env.VITE_EXAM_DURATION_MINUTES ?? '30',
)

export function assertFinitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return value
}
