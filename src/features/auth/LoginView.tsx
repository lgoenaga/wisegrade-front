import { useMemo, useState } from 'react'
import { apiPostJson } from '../../lib/api'
import type { AuthLoginRequest, AuthMeResponse } from './types'

type Props = {
  onLoggedIn: (me: AuthMeResponse) => void
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback
  const msg = (err as Record<string, unknown>).message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg == null) return fallback
  return String(msg)
}

export function LoginView({ onLoggedIn }: Props) {
  const [documento, setDocumento] = useState('')
  const [clave, setClave] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => {
    return !busy && documento.trim().length > 0 && clave.trim().length > 0
  }, [busy, clave, documento])

  async function handleLogin() {
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      const payload: AuthLoginRequest = { documento: documento.trim(), clave }
      const me = await apiPostJson<AuthMeResponse>('/api/auth/login', payload)
      onLoggedIn(me)
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'No se pudo iniciar sesión'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', textAlign: 'left' }}>
      <div className="card stack">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Iniciar sesión</h2>
          <p className="muted" style={{ marginTop: 3, marginBottom: 0, fontSize: 13 }}>
            Ingresa con documento y clave.
          </p>
        </div>

        <div className="field">
          <label>Documento</label>
          <input
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            placeholder="Documento…"
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label>Clave</label>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="Clave…"
            autoComplete="current-password"
          />
        </div>

        {error ? (
          <p style={{ margin: 0 }}>
            <strong>Error:</strong> {error}
          </p>
        ) : null}

        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btnSecondary" onClick={handleLogin} disabled={!canSubmit}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </div>
      </div>
    </div>
  )
}
