import './App.css'
import { useEffect, useState } from 'react'
import { apiPostJson } from './lib/api'
import { StartAttemptForm } from './features/exam/StartAttemptForm'
import { ExamAttemptView } from './features/exam/ExamAttemptView'
import type { IntentoIniciarRequest, IntentoIniciarResponse } from './features/exam/types'
import {
  clearLastAttemptId,
  loadAttemptDraft,
  loadLastAttemptId,
  saveAttemptDraft,
  saveLastAttemptId,
} from './features/exam/examStorage'

function App() {
  const [attempt, setAttempt] = useState<IntentoIniciarResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const lastAttemptId = loadLastAttemptId()
    if (!lastAttemptId) return
    const draft = loadAttemptDraft(lastAttemptId)
    if (!draft) {
      clearLastAttemptId()
      return
    }
    setAttempt(draft.intentoSnapshot)
  }, [])

  async function handleStart(req: IntentoIniciarRequest) {
    setBusy(true)
    setError(undefined)
    try {
      const res = await apiPostJson<IntentoIniciarResponse>('/api/intentos/iniciar', req)
      setAttempt(res)

      saveAttemptDraft({
        intentoSnapshot: res,
        answersByPreguntaId: {},
        pendingSubmit: false,
        antiCheatWarnings: 0,
        blocked: false,
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
