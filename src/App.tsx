import './App.css'
import { useEffect, useState } from 'react'
import { apiGetJson, apiPostJson } from './lib/api'
import { LoginView } from './features/auth/LoginView'
import type { AuthMeResponse, UserRole } from './features/auth/types'
import { StartAttemptForm } from './features/exam/StartAttemptForm'
import { ExamAttemptView } from './features/exam/ExamAttemptView'
import { ResultsView } from './features/results/ResultsView'
import cesdeLogo from './assets/logo-Cesde-2023.svg'
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

function extractErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback
  const msg = (err as Record<string, unknown>).message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg == null) return fallback
  return String(msg)
}

function extractErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const status = (err as Record<string, unknown>).status
  return typeof status === 'number' ? status : null
}

function App() {
  const [attempt, setAttempt] = useState<IntentoSnapshot | null>(null)
  const [screen, setScreen] = useState<'start' | 'results'>('start')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const [me, setMe] = useState<AuthMeResponse | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    let cancelled = false

    ;(async () => {
      try {
        const res = await apiGetJson<AuthMeResponse>('/auth/me', ac.signal)
        if (cancelled) return
        setMe(res)
      } catch (e: unknown) {
        // In dev (React StrictMode), effects can be started/stopped quickly.
        // AbortError is expected when cleanup runs.
        if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError') {
          if (cancelled) return
          setMe(null)
          return
        }
        const status = extractErrorStatus(e)
        // When not logged in, backend responds 401/403.
        if (status !== 401 && status !== 403) {
          console.warn('[WiseGrade] /auth/me failed:', e)
        }
        if (cancelled) return
        setMe(null)
      } finally {
        if (!cancelled) setAuthChecked(true)
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
  }, [])

  useEffect(() => {
    if (!me) return
    if (me.rol === 'DOCENTE') {
      setScreen('results')
    } else {
      setScreen('start')
    }
  }, [me])

  useEffect(() => {
    if (!me) return
    const rol: UserRole = me.rol
    if (rol !== 'ADMIN' && rol !== 'ESTUDIANTE') return

    const lastAttemptId = loadLastAttemptId()
    if (!lastAttemptId) return

    let cancelled = false
    const ac = new AbortController()

    ;(async () => {
      try {
        const serverAttempt = await apiGetJson<IntentoDetalleResponse>(
          `/intentos/${lastAttemptId}`,
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
            meta: draft?.meta,
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
      } catch (e: unknown) {
        if (extractErrorStatus(e) === 404) {
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
  }, [me])

  async function handleStart(req: IntentoIniciarRequest, meta?: { materiaNombre?: string }) {
    setBusy(true)
    setError(undefined)
    try {
      const res = await apiPostJson<IntentoIniciarResponse>('/intentos/iniciar', req)
      if (res.estado === 'SUBMITTED') {
        const serverAttempt = await apiGetJson<IntentoDetalleResponse>(`/intentos/${res.intentoId}`)
        setAttempt(serverAttempt)

        const answersByPreguntaId: Record<string, RespuestaCorrecta> = {}
        for (const r of serverAttempt.respuestas ?? []) {
          answersByPreguntaId[String(r.preguntaId)] = r.respuesta
        }

        saveAttemptDraft({
          intentoSnapshot: serverAttempt,
          meta: meta?.materiaNombre ? { materiaNombre: meta.materiaNombre } : undefined,
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
      const mergedMeta = meta?.materiaNombre
        ? { materiaNombre: meta.materiaNombre }
        : existingDraft?.meta

      saveAttemptDraft({
        intentoSnapshot: res,
        meta: mergedMeta,
        answersByPreguntaId: existingDraft?.answersByPreguntaId ?? {},
        pendingSubmit: existingDraft?.pendingSubmit ?? false,
        antiCheatWarnings: Number.isFinite(existingDraft?.antiCheatWarnings)
          ? (existingDraft?.antiCheatWarnings as number)
          : 0,
        blocked: existingDraft?.blocked ?? false,
      })
      saveLastAttemptId(res.intentoId)
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Error iniciando intento'))
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

  async function handleLogout() {
    try {
      await apiPostJson<void>('/auth/logout', {})
    } catch {
      // Ignore logout failures; clearing client state is still useful.
    } finally {
      setMe(null)
      setAttempt(null)
      clearLastAttemptId()
      setScreen('start')
    }
  }

  if (!authChecked) {
    return (
      <div className="app">
        <header className="appHeader">
          <div className="appHeaderInner">
            <img className="appLogo" src={cesdeLogo} alt="CESDE" />
            <div className="appTitle">
              <div className="appName">WiseGrade</div>
              <div className="appSubtitle">Examen en línea</div>
            </div>
          </div>
        </header>
        <main className="appMain">
          <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
            Cargando…
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appHeaderInner">
          <img className="appLogo" src={cesdeLogo} alt="CESDE" />
          <div className="appTitle">
            <div className="appName">WiseGrade</div>
            <div className="appSubtitle">Examen en línea</div>
          </div>
          <div className="appHeaderActions">
            {me ? (
              <button className="btnSecondary headerBtn" onClick={handleLogout}>
                Salir
              </button>
            ) : null}

            {me && !attempt && me.rol === 'ADMIN' ? (
              screen === 'start' ? (
                <button className="btnSecondary headerBtn" onClick={() => setScreen('results')}>
                  Ver resultados
                </button>
              ) : (
                <button className="btnSecondary headerBtn" onClick={() => setScreen('start')}>
                  Volver
                </button>
              )
            ) : null}
          </div>
        </div>
      </header>

      <main className="appMain">
        {!me ? (
          <LoginView
            onLoggedIn={(next) => {
              setMe(next)
              setAttempt(null)
              clearLastAttemptId()
            }}
          />
        ) : attempt ? (
          <ExamAttemptView intento={attempt} onSubmitted={handleSubmitted} />
        ) : me.rol === 'DOCENTE' ? (
          <ResultsView lockedDocenteId={me.docente?.id ?? null} />
        ) : me.rol === 'ESTUDIANTE' ? (
          <StartAttemptForm
            onStart={handleStart}
            busy={busy}
            error={error}
            lockedEstudiante={me.estudiante}
          />
        ) : (
          screen === 'results' ? (
            <ResultsView />
          ) : (
            <StartAttemptForm onStart={handleStart} busy={busy} error={error} />
          )
        )}
      </main>
    </div>
  )
}

export default App
