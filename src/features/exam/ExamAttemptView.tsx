import './ExamAttemptView.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiGetBlob, apiGetJson, apiPostJson } from '../../lib/api'
import { EXAM_DURATION_MINUTES, assertFinitePositive } from '../../lib/config'
import { loadAttemptDraft, saveAttemptDraft } from './examStorage'
import type {
  IntentoEnviarRequest,
  IntentoEnviarResponse,
  IntentoDetalleResponse,
  IntentoGuardarRequest,
  IntentoGuardarResponse,
  IntentoBlockRequest,
  IntentoBlockResponse,
  IntentoSnapshot,
  PreguntaGeneratedResponse,
  CorreccionPreguntaResponse,
  RespuestaGuardadaResponse,
  RespuestaCorrecta,
} from './types'

const EXAM_NOTRANSLATE_CLASS = 'notranslate'

function isRespuestaCorrecta(value: string): value is RespuestaCorrecta {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D'
}

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
  const startedAt = intento.startedAt
  const deadlineAt = (intento as { deadlineAt?: string | null }).deadlineAt ?? null

  const durationMinutes = useMemo(
    () => assertFinitePositive(EXAM_DURATION_MINUTES, 'VITE_EXAM_DURATION_MINUTES'),
    [],
  )
  const deadlineMs = useMemo(() => {
    const deadlineFromServerMs = deadlineAt ? new Date(deadlineAt).getTime() : NaN
    if (Number.isFinite(deadlineFromServerMs)) {
      return deadlineFromServerMs
    }

    const startedMs = new Date(startedAt).getTime()
    return startedMs + durationMinutes * 60_000
  }, [startedAt, deadlineAt, durationMinutes])

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
  const persistTimerRef = useRef<number | null>(null)
  const lastWarnAtRef = useRef<number>(0)
  const lastWarnKeyRef = useRef<string>('')
  const hadFullscreenRef = useRef<boolean>(false)
  const blockReportedRef = useRef<boolean>(false)
  const timeAutoSubmitTriggeredRef = useRef<boolean>(false)

  const serverSaveTimerRef = useRef<number | null>(null)

  const navInitializedRef = useRef<boolean>(false)

  const leaveSinceRef = useRef<number | null>(null)
  const leaveWarnedRef = useRef<boolean>(false)

  // restore draft
  useEffect(() => {
    setHydrated(false)
    navInitializedRef.current = false
    setError(null)
    setSubmitting(false)
    setSubmitOk(false)
    setSubmittedDetail(null)
    timeAutoSubmitTriggeredRef.current = false
    blockReportedRef.current = false
    const draft = loadAttemptDraft(intento.intentoId)
    setAttemptMeta(draft?.meta ?? null)
    const serverAnswers = answersFromServer('respuestas' in intento ? intento.respuestas : undefined)
    const hasServerAnswers = Object.keys(serverAnswers).length > 0
    const hasServerSnapshot = 'respuestas' in intento
    const shouldTrustServer = hasServerSnapshot && (intento.estado === 'SUBMITTED' || hasServerAnswers)
    const serverBlocked = intento.estado === 'BLOCKED'

    if (shouldTrustServer) {
      setAnswersByPreguntaId(serverAnswers)
      setPendingSubmit(false)
      setAntiCheatWarnings(Number.isFinite(draft?.antiCheatWarnings) ? (draft?.antiCheatWarnings as number) : 0)
      setBlocked(serverBlocked)
      saveAttemptDraft({
        intentoSnapshot: intento,
        meta: draft?.meta,
        answersByPreguntaId: serverAnswers,
        pendingSubmit: false,
        antiCheatWarnings: Number.isFinite(draft?.antiCheatWarnings) ? (draft?.antiCheatWarnings as number) : 0,
        blocked: serverBlocked,
      })
      setHydrated(true)
      return
    }

    if (draft) {
      setAnswersByPreguntaId(draft.answersByPreguntaId ?? {})
      setPendingSubmit(Boolean(draft.pendingSubmit))
      setAntiCheatWarnings(Number.isFinite(draft.antiCheatWarnings) ? draft.antiCheatWarnings : 0)
      setBlocked(serverBlocked)
      setHydrated(true)
      return
    }

    saveAttemptDraft({
      intentoSnapshot: intento,
      answersByPreguntaId: {},
      pendingSubmit: false,
      antiCheatWarnings: 0,
      blocked: serverBlocked,
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

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const previousHtmlTranslate = html.getAttribute('translate')
    const previousBodyTranslate = body.getAttribute('translate')
    const previousHtmlLang = html.getAttribute('lang')

    html.setAttribute('translate', 'no')
    body.setAttribute('translate', 'no')
    html.setAttribute('lang', 'es')
    html.classList.add(EXAM_NOTRANSLATE_CLASS)
    body.classList.add(EXAM_NOTRANSLATE_CLASS)

    return () => {
      if (previousHtmlTranslate == null) {
        html.removeAttribute('translate')
      } else {
        html.setAttribute('translate', previousHtmlTranslate)
      }

      if (previousBodyTranslate == null) {
        body.removeAttribute('translate')
      } else {
        body.setAttribute('translate', previousBodyTranslate)
      }

      if (previousHtmlLang == null) {
        html.removeAttribute('lang')
      } else {
        html.setAttribute('lang', previousHtmlLang)
      }

      html.classList.remove(EXAM_NOTRANSLATE_CLASS)
      body.classList.remove(EXAM_NOTRANSLATE_CLASS)
    }
  }, [])

  const isSubmitted = submitOk || intento.estado === 'SUBMITTED'
  const isServerBlocked = intento.estado === 'BLOCKED'
  const isBlocked = blocked || isServerBlocked

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
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }

    // Debounce to avoid frequent synchronous localStorage writes while answering.
    persistTimerRef.current = window.setTimeout(() => {
      saveAttemptDraft({
        intentoSnapshot: submitOk ? { ...intento, estado: 'SUBMITTED' } : intento,
        answersByPreguntaId,
        pendingSubmit,
        antiCheatWarnings,
        blocked,
      })
      persistTimerRef.current = null
    }, 250)

    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
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
    if (isBlocked) {
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

  // When blocked (anti-cheat), persist answers and notify backend. Do NOT auto-submit.
  useEffect(() => {
    if (!blocked) return
    if (submitOk) return
    if (blockReportedRef.current) return
    blockReportedRef.current = true

    const respuestas = intento.preguntas
      .map((p) => {
        const r = answersByPreguntaId[String(p.id)]
        return r ? { preguntaId: p.id, respuesta: r } : null
      })
      .filter(Boolean) as Array<{ preguntaId: number; respuesta: RespuestaCorrecta }>

    const savePayload: IntentoGuardarRequest = { respuestas }
    const blockPayload: IntentoBlockRequest = { reason: 'anticheat: warnings>=3' }

    ;(async () => {
      try {
        await apiPostJson<IntentoGuardarResponse>(`/intentos/${intento.intentoId}/guardar`, savePayload)
      } catch {
        // Best-effort: blocking should still occur even if save fails.
      }

      try {
        await apiPostJson<IntentoBlockResponse>(`/intentos/${intento.intentoId}/anticheat/block`, blockPayload)
      } catch {
        // Ignore.
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, submitOk, intento.intentoId])

  // Best-effort server-side partial save while answering.
  useEffect(() => {
    if (!hydrated) return
    if (submitOk) return
    if (pendingSubmit) return
    if (isBlocked) return

    if (serverSaveTimerRef.current != null) {
      window.clearTimeout(serverSaveTimerRef.current)
      serverSaveTimerRef.current = null
    }

    serverSaveTimerRef.current = window.setTimeout(() => {
      const respuestas = intento.preguntas
        .map((p) => {
          const r = answersByPreguntaId[String(p.id)]
          return r ? { preguntaId: p.id, respuesta: r } : null
        })
        .filter(Boolean) as Array<{ preguntaId: number; respuesta: RespuestaCorrecta }>

      const payload: IntentoGuardarRequest = { respuestas }
      void apiPostJson<IntentoGuardarResponse>(`/intentos/${intento.intentoId}/guardar`, payload).catch(() => {
        // Silent: local draft is still the primary buffer.
      })

      serverSaveTimerRef.current = null
    }, 900)

    return () => {
      if (serverSaveTimerRef.current != null) {
        window.clearTimeout(serverSaveTimerRef.current)
        serverSaveTimerRef.current = null
      }
    }
  }, [answersByPreguntaId, hydrated, intento.intentoId, intento.preguntas, isBlocked, pendingSubmit, submitOk])

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
    if (isBlocked) return
    if (timeAutoSubmitTriggeredRef.current) return
    timeAutoSubmitTriggeredRef.current = true

    setPendingSubmit(true)
    void trySubmit(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimeUp, submitOk, submitting, pendingSubmit, isBlocked])

  const answeredCount = intento.preguntas.reduce((acc, p) => {
    return answersByPreguntaId[String(p.id)] ? acc + 1 : acc
  }, 0)
  const missingCount = Math.max(0, intento.preguntas.length - answeredCount)

  function setAnswer(preguntaId: number, respuesta: RespuestaCorrecta) {
    setAnswersByPreguntaId((prev) => ({ ...prev, [String(preguntaId)]: respuesta }))
  }

  function handleOptionChange(preguntaId: number, value: string) {
    if (!isRespuestaCorrecta(value)) return
    setAnswer(preguntaId, value)
  }

  const canSubmit =
    !submitOk &&
    !submitting &&
    !pendingSubmit &&
    intento.preguntas.length > 0 &&
    !isBlocked &&
    (missingCount === 0 || isTimeUp)

  const totalPreguntas = intento.preguntas.length
  const currentPregunta = totalPreguntas > 0 ? intento.preguntas[currentIdx] : null
  const selected = currentPregunta ? answersByPreguntaId[String(currentPregunta.id)] : undefined
  const corr = currentPregunta && isSubmitted ? correccionByPreguntaId.get(currentPregunta.id) : undefined

  if (isBlocked && !isSubmitted) {
    return (
      <div className="examAttemptContainer">
        <div className="card examAttemptCardPadded">
          <h2 className="examAttemptHeading">Examen bloqueado</h2>
          <p className="examAttemptBlockedMessage">
            Este intento fue bloqueado por antitrampa. Contacta al docente para que lo reabra o lo envíe.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="examAttemptContainer notranslate" translate="no">
      <div className="examAttemptHeaderRow">
        <h2 className="examAttemptHeading">
          Examen{materiaNombre ? `: ${materiaNombre}` : ''}
        </h2>
        <div className="examAttemptTimer">
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

      <div className="examAttemptMetaTop">
        ID Examen: <strong>{intento.examenId}</strong>
      </div>

      <div className="examAttemptMeta">
        Estado: <strong>{submitOk ? 'ENVIADO' : pendingSubmit ? 'PENDIENTE DE ENVÍO' : 'EN PROGRESO'}</strong>
      </div>

      {isSubmitted ? (
        <div className="examAttemptInfo">
          <strong>Resultado:</strong>{' '}
          {submittedDetail?.resultado ? (
            <span>
              {submittedDetail.resultado.correctas}/{submittedDetail.resultado.total} correctas · Nota:{' '}
              {submittedDetail.resultado.notaSobre5.toFixed(2)}/5.00
            </span>
          ) : (
            <span className="examAttemptDim">Calificación no disponible (aún).</span>
          )}
        </div>
      ) : null}

      {isSubmitted ? (
        <div className="examAttemptActions">
          <button type="button" className="btnSecondary examBtn" onClick={() => void handleExportPdf()} disabled={exportingPdf}>
            {exportingPdf ? 'Exportando PDF…' : 'Exportar PDF'}
          </button>
        </div>
      ) : null}

      {!submitOk ? (
        <div className="examAttemptMeta">
          Antitrampa: <strong>{isBlocked ? 'BLOQUEADO' : `${antiCheatWarnings}/3`}</strong>
          {antiCheatWarnings > 0 && !isBlocked ? <span> · Al llegar a 3 se bloquea</span> : null}
        </div>
      ) : null}

      {!submitOk ? (
        <div className="examAttemptMeta">
          Respondidas: <strong>{answeredCount}</strong> / {intento.preguntas.length}
          {missingCount > 0 ? (
            <span>
              {' '}
              · Faltan <strong>{missingCount}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {!submitOk ? (
        <p className="examAttemptInfo muted notranslate" translate="no">
          Para evitar errores durante el examen, desactiva la traduccion automatica del navegador.
        </p>
      ) : null}

      {error ? (
        <p className="examAttemptInfo">
          <strong>Error:</strong> {error}
        </p>
      ) : null}

      {antiCheatNote ? (
        <p className="examAttemptInfo">
          <strong>Antitrampa:</strong> {antiCheatNote}
        </p>
      ) : null}

      {!submitOk && !isBlocked ? (
        <div className="examAttemptActions">
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

      <div className="stack examAttemptQuestionSection">
        <div className="row examAttemptQuestionNav">
          <div className="muted examAttemptQuestionCounter">
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
          <div className="card notranslate" translate="no">
            <div className="examAttemptQuestionStem">
              <span className="notranslate" translate="no">
                <strong>{currentIdx + 1}.</strong>{' '}
              </span>
              <span>{currentPregunta.enunciado}</span>
              {isSubmitted && corr ? (
                <span className="notranslate examAttemptQuestionStatus" translate="no">
                  · <strong>{corr.esCorrecta ? 'Correcta' : 'Incorrecta'}</strong>
                </span>
              ) : null}
            </div>

            <div className="notranslate examAttemptOptions" translate="no">
              {optionsFor(currentPregunta).map((o) => (
                <label
                  key={o.key}
                  className="notranslate examAttemptOption"
                  translate="no"
                >
                  <input
                    type="radio"
                    name={`p-${currentPregunta.id}`}
                    value={o.key}
                    data-pregunta-id={currentPregunta.id}
                    data-option-key={o.key}
                    checked={selected === o.key}
                    onChange={(event) => handleOptionChange(currentPregunta.id, event.currentTarget.value)}
                    disabled={submitOk || isTimeUp || isBlocked}
                    className="examAttemptOptionInput"
                  />
                  <span>
                    <span className="notranslate" translate="no">
                      <strong>{o.key}.</strong>{' '}
                    </span>
                    <span>{o.text}</span>
                  </span>
                </label>
              ))}
            </div>

            {isSubmitted && corr ? (
              <div className="examAttemptCorrection">
                <div>
                  <strong>Tu respuesta:</strong> {corr.respuestaEstudiante ?? 'Sin responder'}
                </div>
                <div>
                  <strong>Correcta:</strong> {corr.respuestaCorrecta}
                </div>
                {corr.explicacion ? (
                  <div className="examAttemptExplanation">
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
        <p className="examAttemptPending">Reintentando envío automáticamente…</p>
      ) : null}
    </div>
  )
}
