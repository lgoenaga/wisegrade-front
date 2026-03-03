import { loadJson, loadString, remove, removeItem, saveJson, saveString } from '../../lib/storage'
import type { IntentoSnapshot, RespuestaCorrecta } from './types'

export type AttemptDraft = {
  intentoSnapshot: IntentoSnapshot
  meta?: {
    materiaNombre?: string
  }
  answersByPreguntaId: Record<string, RespuestaCorrecta>
  pendingSubmit: boolean
  antiCheatWarnings: number
  blocked: boolean
}

const lastSnapshotSignatureByAttemptId = new Map<number, string>()

function snapshotSignature(intentoSnapshot: IntentoSnapshot): string {
  const preguntasLen = Array.isArray(intentoSnapshot.preguntas) ? intentoSnapshot.preguntas.length : 0
  return `${intentoSnapshot.intentoId}|${intentoSnapshot.estado}|${intentoSnapshot.startedAt}|${intentoSnapshot.cantidad}|${preguntasLen}`
}

type AttemptStateDraft = {
  meta?: {
    materiaNombre?: string
  }
  answersByPreguntaId: Record<string, RespuestaCorrecta>
  pendingSubmit: boolean
  antiCheatWarnings: number
  blocked: boolean
}

function keyForAttempt(intentoId: number): string {
  return `wisegrade:attempt:${intentoId}`
}

function snapshotKeyForAttempt(intentoId: number): string {
  return `wisegrade:attempt:${intentoId}:snapshot`
}

function stateKeyForAttempt(intentoId: number): string {
  return `wisegrade:attempt:${intentoId}:state`
}

const LAST_ATTEMPT_ID_KEY = 'wisegrade:lastAttemptId'

export function loadLastAttemptId(): number | null {
  const raw = loadString(LAST_ATTEMPT_ID_KEY)
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i > 0 ? i : null
}

export function saveLastAttemptId(intentoId: number): void {
  saveString(LAST_ATTEMPT_ID_KEY, String(intentoId))
}

export function clearLastAttemptId(): void {
  removeItem(LAST_ATTEMPT_ID_KEY)
}

export function loadAttemptDraft(intentoId: number): AttemptDraft | null {
  const snapshot = loadJson<{ intentoSnapshot: IntentoSnapshot }>(snapshotKeyForAttempt(intentoId))
  const state = loadJson<AttemptStateDraft>(stateKeyForAttempt(intentoId))

  if (snapshot?.intentoSnapshot && state) {
    return {
      intentoSnapshot: snapshot.intentoSnapshot,
      meta: state.meta,
      answersByPreguntaId: state.answersByPreguntaId ?? {},
      pendingSubmit: Boolean(state.pendingSubmit),
      antiCheatWarnings: Number.isFinite(state.antiCheatWarnings) ? state.antiCheatWarnings : 0,
      blocked: Boolean(state.blocked),
    }
  }

  // Legacy: single key with full AttemptDraft. Migrate to split keys.
  const legacy = loadJson<AttemptDraft>(keyForAttempt(intentoId))
  if (!legacy) return null

  saveAttemptDraft(legacy)
  remove(keyForAttempt(intentoId))
  return legacy
}

export function saveAttemptDraft(draft: AttemptDraft): void {
  saveAttemptSnapshot(draft.intentoSnapshot)
  saveAttemptState(draft.intentoSnapshot.intentoId, {
    meta: draft.meta,
    answersByPreguntaId: draft.answersByPreguntaId ?? {},
    pendingSubmit: Boolean(draft.pendingSubmit),
    antiCheatWarnings: Number.isFinite(draft.antiCheatWarnings) ? draft.antiCheatWarnings : 0,
    blocked: Boolean(draft.blocked),
  })
}

export function saveAttemptSnapshot(intentoSnapshot: IntentoSnapshot): void {
  const intentoId = intentoSnapshot.intentoId
  const sig = snapshotSignature(intentoSnapshot)
  if (lastSnapshotSignatureByAttemptId.get(intentoId) === sig) return
  lastSnapshotSignatureByAttemptId.set(intentoId, sig)
  saveJson(snapshotKeyForAttempt(intentoId), { intentoSnapshot })
}

export function saveAttemptState(intentoId: number, state: AttemptStateDraft): void {
  saveJson(stateKeyForAttempt(intentoId), state)
}

export function clearAttemptDraft(intentoId: number): void {
  remove(snapshotKeyForAttempt(intentoId))
  remove(stateKeyForAttempt(intentoId))
  remove(keyForAttempt(intentoId))
}
