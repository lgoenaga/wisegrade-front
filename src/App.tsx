import './App.css'
import { useEffect, useState } from 'react'
import { apiGetJson, apiPostJson } from './lib/api'
import { StartAttemptForm } from './features/exam/StartAttemptForm'
import { ExamAttemptView } from './features/exam/ExamAttemptView'
import type {
  IntentoDetalleResponse,
  IntentoIniciarRequest,
  IntentoIniciarResponse,
  IntentoSnapshot,
  RespuestaCorrecta,
} from './features/exam/types'
import {
  clearLastAttemptId,
  loadAttemptDraft,
  loadLastAttemptId,
  saveAttemptDraft,
  saveLastAttemptId,
} from './features/exam/examStorage'

function App() {
  const [attempt, setAttempt] = useState<IntentoSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const lastAttemptId = loadLastAttemptId()
    if (!lastAttemptId) return

    let cancelled = false
    const ac = new AbortController()

    ;(async () => {
      try {
        const serverAttempt = await apiGetJson<IntentoDetalleResponse>(
          `/api/intentos/${lastAttemptId}`,
          ac.signal,
        )
        if (cancelled) return

        const draft = loadAttemptDraft(lastAttemptId)

        // If DB says SUBMITTED, it's the source of truth.
        if (serverAttempt.estado === 'SUBMITTED') {
          const answersByPreguntaId: Record<string, RespuestaCorrecta> = {}
          for (const r of serverAttempt.respuestas ?? []) {
            answersByPreguntaId[String(r.preguntaId)] = r.respuesta
          }

          saveAttemptDraft({
            intentoSnapshot: serverAttempt,
            answersByPreguntaId,
            pendingSubmit: false,
            antiCheatWarnings: Number.isFinite(draft?.antiCheatWarnings)
              ? (draft?.antiCheatWarnings as number)
              : 0,
            blocked: draft?.blocked ?? false,
          })
        } else if (draft) {
          // In progress: backend doesn't have answers yet (saved on submit), so keep local.
          saveAttemptDraft({
            ...draft,
            intentoSnapshot: serverAttempt,
          })
        } else {
          saveAttemptDraft({
            intentoSnapshot: serverAttempt,
            answersByPreguntaId: {},
            pendingSubmit: false,
            antiCheatWarnings: 0,
            blocked: false,
          })
        }

        saveLastAttemptId(serverAttempt.intentoId)
        setAttempt(serverAttempt)
      } catch (e: any) {
        if (e && typeof e === 'object' && 'status' in e && (e as any).status === 404) {
          clearLastAttemptId()
          return
        }

        // Fallback to local draft if backend is unreachable.
        const draft = loadAttemptDraft(lastAttemptId)
        if (!draft) {
          clearLastAttemptId()
          return
        }
        setAttempt(draft.intentoSnapshot)
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
  }, [])

  async function handleStart(req: IntentoIniciarRequest) {
    setBusy(true)
    setError(undefined)
    try {
      const res = await apiPostJson<IntentoIniciarResponse>('/api/intentos/iniciar', req)
      if (res.estado === 'SUBMITTED') {
        const serverAttempt = await apiGetJson<IntentoDetalleResponse>(`/api/intentos/${res.intentoId}`)
        setAttempt(serverAttempt)

        const answersByPreguntaId: Record<string, RespuestaCorrecta> = {}
        for (const r of serverAttempt.respuestas ?? []) {
          answersByPreguntaId[String(r.preguntaId)] = r.respuesta
        }

        saveAttemptDraft({
          intentoSnapshot: serverAttempt,
          answersByPreguntaId,
          pendingSubmit: false,
          antiCheatWarnings: 0,
          blocked: false,
        })
        saveLastAttemptId(serverAttempt.intentoId)
        return
      }

      setAttempt(res)

      const existingDraft = loadAttemptDraft(res.intentoId)

      saveAttemptDraft({
        intentoSnapshot: res,
        answersByPreguntaId: existingDraft?.answersByPreguntaId ?? {},
        pendingSubmit: existingDraft?.pendingSubmit ?? false,
        antiCheatWarnings: Number.isFinite(existingDraft?.antiCheatWarnings)
          ? (existingDraft?.antiCheatWarnings as number)
          : 0,
        blocked: existingDraft?.blocked ?? false,
      })
      saveLastAttemptId(res.intentoId)
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Error iniciando intento')
    } finally {
      setBusy(false)
    }
  }

  function handleSubmitted(attemptId: number) {
    // Keep the attempt visible after submission so the student sees the final notice.
    // Mark it as SUBMITTED to persist the state across refresh.
    setAttempt((prev) => (prev ? { ...prev, estado: 'SUBMITTED' } : prev))
    saveLastAttemptId(attemptId)
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>WiseGrade</h1>
      {attempt ? (
        <ExamAttemptView intento={attempt} onSubmitted={handleSubmitted} />
      ) : (
        <StartAttemptForm onStart={handleStart} busy={busy} error={error} />
      )}
    </div>
  )
}

export default App
