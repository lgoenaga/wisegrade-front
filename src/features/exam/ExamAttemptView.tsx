import { useEffect, useMemo, useRef, useState } from 'react'
import { apiPostJson } from '../../lib/api'
import { EXAM_DURATION_MINUTES, assertFinitePositive } from '../../lib/config'
import { loadAttemptDraft, saveAttemptDraft } from './examStorage'
import type {
  IntentoEnviarRequest,
  IntentoEnviarResponse,
  IntentoSnapshot,
  PreguntaGeneratedResponse,
  RespuestaGuardadaResponse,
  RespuestaCorrecta,
} from './types'

type Props = {
  intento: IntentoSnapshot
  onSubmitted: (attemptId: number) => void
}

function answersFromServer(respuestas: RespuestaGuardadaResponse[] | undefined): Record<string, RespuestaCorrecta> {
  const map: Record<string, RespuestaCorrecta> = {}
  if (!Array.isArray(respuestas)) return map
  for (const r of respuestas) {
    if (!r) continue
    map[String(r.preguntaId)] = r.respuesta
  }
  return map
}

function optionsFor(p: PreguntaGeneratedResponse) {
  const opts = p.opciones
  return [
    { key: 'A' as const, text: opts[0] ?? '' },
    { key: 'B' as const, text: opts[1] ?? '' },
    { key: 'C' as const, text: opts[2] ?? '' },
    { key: 'D' as const, text: opts[3] ?? '' },
  ]
}

export function ExamAttemptView({ intento, onSubmitted }: Props) {
  const durationMinutes = useMemo(
    () => assertFinitePositive(EXAM_DURATION_MINUTES, 'VITE_EXAM_DURATION_MINUTES'),
    [],
  )
  const deadlineMs = useMemo(() => {
    const startedMs = new Date(intento.startedAt).getTime()
    return startedMs + durationMinutes * 60_000
  }, [intento.startedAt, durationMinutes])

  const [answersByPreguntaId, setAnswersByPreguntaId] = useState<Record<string, RespuestaCorrecta>>({})
  const [pendingSubmit, setPendingSubmit] = useState(false)
  const [antiCheatWarnings, setAntiCheatWarnings] = useState(0)
  const [blocked, setBlocked] = useState(false)
  const [submitOk, setSubmitOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [antiCheatNote, setAntiCheatNote] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [hydrated, setHydrated] = useState(false)

  const retryTimerRef = useRef<number | null>(null)
  const lastWarnAtRef = useRef<number>(0)
  const lastWarnKeyRef = useRef<string>('')
  const hadFullscreenRef = useRef<boolean>(false)
  const autoSubmitTriggeredRef = useRef<boolean>(false)

  const leaveSinceRef = useRef<number | null>(null)
  const leaveWarnedRef = useRef<boolean>(false)

  // restore draft
  useEffect(() => {
    setHydrated(false)
    const draft = loadAttemptDraft(intento.intentoId)
    const serverAnswers = answersFromServer('respuestas' in intento ? intento.respuestas : undefined)
    const hasServerAnswers = Object.keys(serverAnswers).length > 0
    const hasServerSnapshot = 'respuestas' in intento
    const shouldTrustServer = hasServerSnapshot && (intento.estado === 'SUBMITTED' || hasServerAnswers)

    if (shouldTrustServer) {
      setAnswersByPreguntaId(serverAnswers)
      setPendingSubmit(false)
      setAntiCheatWarnings(Number.isFinite(draft?.antiCheatWarnings) ? (draft?.antiCheatWarnings as number) : 0)
      setBlocked(Boolean(draft?.blocked))
      saveAttemptDraft({
        intentoSnapshot: intento,
        answersByPreguntaId: serverAnswers,
        pendingSubmit: false,
        antiCheatWarnings: Number.isFinite(draft?.antiCheatWarnings) ? (draft?.antiCheatWarnings as number) : 0,
        blocked: draft?.blocked ?? false,
      })
      setHydrated(true)
      return
    }

    if (draft) {
      setAnswersByPreguntaId(draft.answersByPreguntaId ?? {})
      setPendingSubmit(Boolean(draft.pendingSubmit))
      setAntiCheatWarnings(Number.isFinite(draft.antiCheatWarnings) ? draft.antiCheatWarnings : 0)
      setBlocked(Boolean(draft.blocked))
      setHydrated(true)
      return
    }

    saveAttemptDraft({
      intentoSnapshot: intento,
      answersByPreguntaId: {},
      pendingSubmit: false,
      antiCheatWarnings: 0,
      blocked: false,
    })
    setHydrated(true)
  }, [intento])

  // Reflect backend state if the attempt was already submitted.
  useEffect(() => {
    if (intento.estado === 'SUBMITTED') {
      setSubmitOk(true)
      setPendingSubmit(false)
    }
  }, [intento.estado])

  // countdown tick (freeze once submitted)
  useEffect(() => {
    if (submitOk) {
      return
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [submitOk])

  // persist answers & pending flag
  useEffect(() => {
    if (!hydrated) return
    saveAttemptDraft({
      intentoSnapshot: submitOk ? { ...intento, estado: 'SUBMITTED' } : intento,
      answersByPreguntaId,
      pendingSubmit,
      antiCheatWarnings,
      blocked,
    })
  }, [answersByPreguntaId, pendingSubmit, antiCheatWarnings, blocked, intento, submitOk, hydrated])

  async function trySubmit(force: boolean = false) {
    if (submitting) return
    if (submitOk) return
    if (!force && missingCount > 0 && !isTimeUp) return
    setError(null)
    setSubmitting(true)

    const respuestas = intento.preguntas
      .map((p) => {
        const r = answersByPreguntaId[String(p.id)]
        return r ? { preguntaId: p.id, respuesta: r } : null
      })
      .filter(Boolean) as Array<{ preguntaId: number; respuesta: RespuestaCorrecta }>

    const payload: IntentoEnviarRequest = {
      intentoId: intento.intentoId,
      respuestas,
    }

    try {
      const res = await apiPostJson<IntentoEnviarResponse>('/api/intentos/enviar', payload)
      if (res.estado === 'SUBMITTED') {
        setSubmitOk(true)
        setPendingSubmit(false)
        if (autoSubmitTriggeredRef.current || blocked) {
          setAntiCheatNote('Intento enviado automáticamente por antitrampa. No se puede presentar nuevamente.')
        }
        onSubmitted(intento.intentoId)
      } else {
        setPendingSubmit(true)
      }
    } catch (e: any) {
      setPendingSubmit(true)
      setError(e?.message ? String(e.message) : 'Error enviando respuestas')
    } finally {
      setSubmitting(false)
    }
  }

  function warnAntiCheat(reason: string, key: string = 'generic') {
    if (submitOk) return
    if (blocked) {
      setAntiCheatNote(`${reason}. Examen ya estaba bloqueado.`)
      return
    }
    const now = Date.now()
    if (now - lastWarnAtRef.current < 900 && lastWarnKeyRef.current === key) return
    lastWarnAtRef.current = now
    lastWarnKeyRef.current = key

    setAntiCheatWarnings((prev) => {
      const next = prev + 1
      setAntiCheatNote(`${reason}. Advertencia ${next}/3.`)
      if (next >= 3) {
        setBlocked(true)
        setAntiCheatNote('Examen bloqueado por múltiples advertencias.')
      }
      return next
    })
  }

  // anti-cheat: tab change + focus loss (count once per leave episode)
  useEffect(() => {
    function resetLeaveEpisodeIfBack() {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        leaveSinceRef.current = null
        leaveWarnedRef.current = false
      }
    }

    function markLeft() {
      if (leaveSinceRef.current == null) {
        leaveSinceRef.current = Date.now()
      }
    }

    function warnOnce(reason: string) {
      if (leaveWarnedRef.current) return
      leaveWarnedRef.current = true
      warnAntiCheat(reason, 'leave')
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        markLeft()
        // When the tab is hidden, it's definitely a leave episode: warn immediately.
        warnOnce('Cambio de pestaña/ventana detectado')
      } else {
        resetLeaveEpisodeIfBack()
      }
    }

    function onBlur() {
      // Blur can be transient; only mark the leave episode and let the poll confirm.
      markLeft()
    }

    function onFocus() {
      resetLeaveEpisodeIfBack()
    }

    function onPageHide() {
      markLeft()
      warnOnce('Salida de la página detectada')
    }

    // Debounced focus poll for browsers that miss events.
    const focusPollId = window.setInterval(() => {
      resetLeaveEpisodeIfBack()

      if (leaveWarnedRef.current) return
      if (leaveSinceRef.current == null) return

      const hasFocus = document.hasFocus()
      if (hasFocus) return

      // Only warn if we've been unfocused for a short, continuous period.
      if (Date.now() - leaveSinceRef.current >= 800) {
        warnOnce('Pérdida de foco/cambio de aplicación detectado')
      }
    }, 400)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur, true)
    window.addEventListener('focus', onFocus, true)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur, true)
      window.removeEventListener('focus', onFocus, true)
      window.removeEventListener('pagehide', onPageHide)
      window.clearInterval(focusPollId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitOk, blocked])

  // anti-cheat: fullscreen exit
  useEffect(() => {
    function onFsChange() {
      const isFullscreen = Boolean(document.fullscreenElement)
      if (isFullscreen) {
        hadFullscreenRef.current = true
        return
      }
      if (hadFullscreenRef.current) {
        warnAntiCheat('Salida de pantalla completa detectada', 'fullscreen')
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitOk, blocked])

  // auto-submit when blocked
  useEffect(() => {
    if (!blocked || submitOk) return
    if (autoSubmitTriggeredRef.current) return
    autoSubmitTriggeredRef.current = true
    setPendingSubmit(true)
    setAntiCheatNote('Examen bloqueado por múltiples advertencias. Enviando automáticamente…')
    void trySubmit(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, submitOk])

  // auto-retry when pending
  useEffect(() => {
    if (!pendingSubmit || submitOk) return
    if (retryTimerRef.current != null) return
    retryTimerRef.current = window.setInterval(() => {
      void trySubmit(true)
    }, 5000)
    return () => {
      if (retryTimerRef.current != null) {
        window.clearInterval(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit, submitOk])

  const remainingMs = Math.max(0, deadlineMs - nowMs)
  const remainingSec = Math.floor(remainingMs / 1000)
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0')
  const ss = String(remainingSec % 60).padStart(2, '0')
  const isTimeUp = remainingMs <= 0

  const answeredCount = intento.preguntas.reduce((acc, p) => {
    return answersByPreguntaId[String(p.id)] ? acc + 1 : acc
  }, 0)
  const missingCount = Math.max(0, intento.preguntas.length - answeredCount)

  function setAnswer(preguntaId: number, respuesta: RespuestaCorrecta) {
    setAnswersByPreguntaId((prev) => ({ ...prev, [String(preguntaId)]: respuesta }))
  }

  const canSubmit =
    !submitOk &&
    !submitting &&
    !pendingSubmit &&
    intento.preguntas.length > 0 &&
    (missingCount === 0 || isTimeUp)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <h2>Examen (intento #{intento.intentoId})</h2>
        <div style={{ textAlign: 'right' }}>
          <div>
            Tiempo restante: <strong>{mm}:{ss}</strong>
          </div>
          {isTimeUp ? (
            <div>
              <strong>Tiempo terminado</strong>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 8, opacity: 0.8 }}>
        Estado: <strong>{submitOk ? 'ENVIADO' : pendingSubmit ? 'PENDIENTE DE ENVÍO' : 'EN PROGRESO'}</strong>
      </div>

      {submitOk ? (
        <p style={{ marginTop: 12 }}>
          <strong>Aviso:</strong> Este intento ya fue enviado y no se puede presentar nuevamente.
        </p>
      ) : null}

      {!submitOk ? (
        <div style={{ marginTop: 8, opacity: 0.8 }}>
          Antitrampa: <strong>{blocked ? 'BLOQUEADO' : `${antiCheatWarnings}/3`}</strong>
          {antiCheatWarnings > 0 && !blocked ? <span> · Al llegar a 3 se bloquea</span> : null}
        </div>
      ) : null}

      {!submitOk ? (
        <div style={{ marginTop: 8, opacity: 0.8 }}>
          Respondidas: <strong>{answeredCount}</strong> / {intento.preguntas.length}
          {missingCount > 0 ? (
            <span>
              {' '}
              · Faltan <strong>{missingCount}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p style={{ marginTop: 12 }}>
          <strong>Error:</strong> {error}
        </p>
      ) : null}

      {antiCheatNote ? (
        <p style={{ marginTop: 12 }}>
          <strong>Antitrampa:</strong> {antiCheatNote}
        </p>
      ) : null}

      {!submitOk && !blocked ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              try {
                await document.documentElement.requestFullscreen()
                setAntiCheatNote(null)
              } catch {
                setAntiCheatNote('No se pudo activar pantalla completa (requiere interacción del navegador).')
              }
            }}
          >
            Entrar a pantalla completa
          </button>
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
        {intento.preguntas.map((p, idx) => {
          const selected = answersByPreguntaId[String(p.id)]
          return (
            <div key={p.id} style={{ border: '1px solid currentColor', borderRadius: 8, padding: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <strong>{idx + 1}.</strong> {p.enunciado}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {optionsFor(p).map((o) => (
                  <label key={o.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="radio"
                      name={`p-${p.id}`}
                      checked={selected === o.key}
                      onChange={() => setAnswer(p.id, o.key)}
                      disabled={submitOk || isTimeUp || blocked}
                    />
                    <span>
                      <strong>{o.key}.</strong> {o.text}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button disabled={!canSubmit} onClick={() => void trySubmit(false)}>
          {submitting ? 'Enviando…' : pendingSubmit ? 'Pendiente…' : 'Enviar'}
        </button>
      </div>

      {pendingSubmit && !submitOk ? (
        <p style={{ marginTop: 8, opacity: 0.8 }}>Reintentando envío automáticamente…</p>
      ) : null}
    </div>
  )
}
