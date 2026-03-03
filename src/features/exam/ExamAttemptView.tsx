import { useEffect, useMemo, useRef, useState } from 'react'
import { apiGetBlob, apiGetJson, apiPostJson } from '../../lib/api'
import { EXAM_DURATION_MINUTES, assertFinitePositive } from '../../lib/config'
import { loadAttemptDraft, saveAttemptDraft } from './examStorage'
import type {
  IntentoEnviarRequest,
  IntentoEnviarResponse,
  IntentoDetalleResponse,
  IntentoSnapshot,
  PreguntaGeneratedResponse,
  CorreccionPreguntaResponse,
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

function extractErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback
  const msg = (err as Record<string, unknown>).message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg == null) return fallback
  return String(msg)
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
  const [attemptMeta, setAttemptMeta] = useState<{ materiaNombre?: string } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [hydrated, setHydrated] = useState(false)
  const [submittedDetail, setSubmittedDetail] = useState<IntentoDetalleResponse | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [exportingPdf, setExportingPdf] = useState(false)

  const retryTimerRef = useRef<number | null>(null)
  const lastWarnAtRef = useRef<number>(0)
  const lastWarnKeyRef = useRef<string>('')
  const hadFullscreenRef = useRef<boolean>(false)
  const autoSubmitTriggeredRef = useRef<boolean>(false)
  const timeAutoSubmitTriggeredRef = useRef<boolean>(false)

  const navInitializedRef = useRef<boolean>(false)

  const leaveSinceRef = useRef<number | null>(null)
  const leaveWarnedRef = useRef<boolean>(false)

  // restore draft
  useEffect(() => {
    setHydrated(false)
    navInitializedRef.current = false
    setError(null)
    timeAutoSubmitTriggeredRef.current = false
    const draft = loadAttemptDraft(intento.intentoId)
    setAttemptMeta(draft?.meta ?? null)
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
        meta: draft?.meta,
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

  const materiaNombre = attemptMeta?.materiaNombre ?? null

  // Initialize the question page (once per attempt) to the first unanswered question.
  useEffect(() => {
    if (!hydrated) return
    if (navInitializedRef.current) return
    navInitializedRef.current = true

    const firstUnansweredIdx = intento.preguntas.findIndex((p) => !answersByPreguntaId[String(p.id)])
    setCurrentIdx(firstUnansweredIdx >= 0 ? firstUnansweredIdx : 0)
  }, [hydrated, intento.preguntas, answersByPreguntaId])

  // Clamp page index if question list changes.
  useEffect(() => {
    setCurrentIdx((prev) => {
      const max = Math.max(0, intento.preguntas.length - 1)
      return Math.min(Math.max(0, prev), max)
    })
  }, [intento.preguntas.length])

  // Reflect backend state if the attempt was already submitted.
  useEffect(() => {
    if (intento.estado === 'SUBMITTED') {
      setSubmitOk(true)
      setPendingSubmit(false)
    }
  }, [intento.estado])

  const isSubmitted = submitOk || intento.estado === 'SUBMITTED'

  async function handleExportPdf() {
    if (!isSubmitted) return
    if (exportingPdf) return
    setExportingPdf(true)
    setError(null)
    try {
      const { blob, filename } = await apiGetBlob(`/intentos/${intento.intentoId}/export/pdf`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || `examen-intento-${intento.intentoId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'No se pudo exportar el PDF'))
    } finally {
      setExportingPdf(false)
    }
  }

  useEffect(() => {
    if (!isSubmitted) {
      setSubmittedDetail(null)
      return
    }

    // If current snapshot is already a detalle response, use it directly.
    if ('resultado' in intento && 'correccion' in intento) {
      setSubmittedDetail(intento as IntentoDetalleResponse)
      return
    }

    const controller = new AbortController()
    ;(async () => {
      try {
        const detalle = await apiGetJson<IntentoDetalleResponse>(`/intentos/${intento.intentoId}`, controller.signal)
        setSubmittedDetail(detalle)
      } catch {
        // If it fails, keep showing the submitted state without correction.
      }
    })()

    return () => controller.abort()
  }, [isSubmitted, intento])

  const correccionByPreguntaId = useMemo(() => {
    const map = new Map<number, CorreccionPreguntaResponse>()
    if (!submittedDetail?.correccion) return map
    for (const c of submittedDetail.correccion) {
      map.set(c.preguntaId, c)
    }
    return map
  }, [submittedDetail])

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
      const res = await apiPostJson<IntentoEnviarResponse>('/intentos/enviar', payload)
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
    } catch (e: unknown) {
      setPendingSubmit(true)
      setError(extractErrorMessage(e, 'Error enviando respuestas'))
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

  // auto-submit when time is up
  useEffect(() => {
    if (!isTimeUp) return
    if (submitOk) return
    if (submitting) return
    if (pendingSubmit) return
    if (timeAutoSubmitTriggeredRef.current) return
    timeAutoSubmitTriggeredRef.current = true

    setPendingSubmit(true)
    void trySubmit(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimeUp, submitOk, submitting, pendingSubmit])

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

  const totalPreguntas = intento.preguntas.length
  const currentPregunta = totalPreguntas > 0 ? intento.preguntas[currentIdx] : null
  const selected = currentPregunta ? answersByPreguntaId[String(currentPregunta.id)] : undefined
  const corr = currentPregunta && isSubmitted ? correccionByPreguntaId.get(currentPregunta.id) : undefined

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          Examen{materiaNombre ? `: ${materiaNombre}` : ''}
        </h2>
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

      <div style={{ marginTop: 2, opacity: 0.8, fontSize: 13 }}>
        ID Examen: <strong>{intento.examenId}</strong>
      </div>

      <div style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>
        Estado: <strong>{submitOk ? 'ENVIADO' : pendingSubmit ? 'PENDIENTE DE ENVÍO' : 'EN PROGRESO'}</strong>
      </div>

      {submitOk ? (
        <p style={{ marginTop: 6, fontSize: 13 }}>
          <strong>Aviso:</strong> Este intento ya fue enviado y no se puede presentar nuevamente.
        </p>
      ) : null}

      {isSubmitted ? (
        <div style={{ marginTop: 6, fontSize: 13 }}>
          <strong>Resultado:</strong>{' '}
          {submittedDetail?.resultado ? (
            <span>
              {submittedDetail.resultado.correctas}/{submittedDetail.resultado.total} correctas · Nota:{' '}
              {submittedDetail.resultado.notaSobre5.toFixed(2)}/5.00
            </span>
          ) : (
            <span style={{ opacity: 0.8 }}>Calificación no disponible (aún).</span>
          )}
        </div>
      ) : null}

      {isSubmitted ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btnSecondary examBtn" onClick={() => void handleExportPdf()} disabled={exportingPdf}>
            {exportingPdf ? 'Exportando PDF…' : 'Exportar PDF'}
          </button>
        </div>
      ) : null}

      {!submitOk ? (
        <div style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>
          Antitrampa: <strong>{blocked ? 'BLOQUEADO' : `${antiCheatWarnings}/3`}</strong>
          {antiCheatWarnings > 0 && !blocked ? <span> · Al llegar a 3 se bloquea</span> : null}
        </div>
      ) : null}

      {!submitOk ? (
        <div style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>
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
        <p style={{ marginTop: 6, fontSize: 13 }}>
          <strong>Error:</strong> {error}
        </p>
      ) : null}

      {antiCheatNote ? (
        <p style={{ marginTop: 6, fontSize: 13 }}>
          <strong>Antitrampa:</strong> {antiCheatNote}
        </p>
      ) : null}

      {!submitOk && !blocked ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="examBtn"
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

      <div style={{ marginTop: 10 }} className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14 }} className="muted">
            Pregunta <strong>{totalPreguntas ? currentIdx + 1 : 0}</strong> / {totalPreguntas}
          </div>
          <div className="row">
            <button
              className="btnSecondary examBtn"
              disabled={totalPreguntas === 0 || currentIdx <= 0}
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            >
              Anterior
            </button>
            <button
              className="btnSecondary examBtn"
              disabled={totalPreguntas === 0 || currentIdx >= totalPreguntas - 1}
              onClick={() => setCurrentIdx((i) => Math.min(totalPreguntas - 1, i + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>

        {currentPregunta ? (
          <div className="card">
            <div style={{ marginBottom: 10 }}>
              <strong>{currentIdx + 1}.</strong> {currentPregunta.enunciado}
              {isSubmitted && corr ? (
                <span style={{ marginLeft: 12, opacity: 0.85 }}>
                  · <strong>{corr.esCorrecta ? 'Correcta' : 'Incorrecta'}</strong>
                </span>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {optionsFor(currentPregunta).map((o) => (
                <label key={o.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name={`p-${currentPregunta.id}`}
                    checked={selected === o.key}
                    onChange={() => setAnswer(currentPregunta.id, o.key)}
                    disabled={submitOk || isTimeUp || blocked}
                    style={{ marginTop: 4 }}
                  />
                  <span>
                    <strong>{o.key}.</strong> {o.text}
                  </span>
                </label>
              ))}
            </div>

            {isSubmitted && corr ? (
              <div style={{ marginTop: 12, opacity: 0.95 }}>
                <div>
                  <strong>Tu respuesta:</strong> {corr.respuestaEstudiante ?? 'Sin responder'}
                </div>
                <div>
                  <strong>Correcta:</strong> {corr.respuestaCorrecta}
                </div>
                {corr.explicacion ? (
                  <div style={{ marginTop: 8 }}>
                    <strong>Explicación:</strong> {corr.explicacion}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="card muted">No hay preguntas para mostrar.</div>
        )}
      </div>

      <div className="examSubmitRow">
        <button className="examBtn examSubmitBtn" disabled={!canSubmit} onClick={() => void trySubmit(false)}>
          {submitting ? 'Enviando…' : pendingSubmit ? 'Pendiente…' : 'Enviar'}
        </button>
      </div>

      {pendingSubmit && !submitOk ? (
        <p style={{ marginTop: 6, opacity: 0.8, fontSize: 13 }}>Reintentando envío automáticamente…</p>
      ) : null}
    </div>
  )
}
