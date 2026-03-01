import { loadJson, remove, saveJson } from '../../lib/storage'
import type { IntentoSnapshot, RespuestaCorrecta } from './types'

export type AttemptDraft = {
  intentoSnapshot: IntentoSnapshot
  answersByPreguntaId: Record<string, RespuestaCorrecta>
  pendingSubmit: boolean
  antiCheatWarnings: number
  blocked: boolean
}

function keyForAttempt(intentoId: number): string {
  return `wisegrade:attempt:${intentoId}`
}

const LAST_ATTEMPT_ID_KEY = 'wisegrade:lastAttemptId'

export function loadLastAttemptId(): number | null {
  const raw = localStorage.getItem(LAST_ATTEMPT_ID_KEY)
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i > 0 ? i : null
}

export function saveLastAttemptId(intentoId: number): void {
  localStorage.setItem(LAST_ATTEMPT_ID_KEY, String(intentoId))
}

export function clearLastAttemptId(): void {
  localStorage.removeItem(LAST_ATTEMPT_ID_KEY)
}

export function loadAttemptDraft(intentoId: number): AttemptDraft | null {
  return loadJson<AttemptDraft>(keyForAttempt(intentoId))
}

export function saveAttemptDraft(draft: AttemptDraft): void {
  saveJson(keyForAttempt(draft.intentoSnapshot.intentoId), draft)
}

export function clearAttemptDraft(intentoId: number): void {
  remove(keyForAttempt(intentoId))
}
