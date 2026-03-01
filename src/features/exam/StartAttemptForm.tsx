import { useEffect, useMemo, useState } from 'react'
import { apiGetJson } from '../../lib/api'
import type { IntentoIniciarRequest } from './types'

type Props = {
  onStart: (req: IntentoIniciarRequest) => void
  busy: boolean
  error?: string
}

type Periodo = { id: number; anio: number; nombre: string }
type Materia = { id: number; nombre: string; nivelId: number; docenteIds: number[] }
type Momento = { id: number; nombre: string }

function toPositiveInt(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i > 0 ? i : null
}

export function StartAttemptForm({ onStart, busy, error }: Props) {
  const [periodoId, setPeriodoId] = useState('')
  const [materiaId, setMateriaId] = useState('')
  const [momentoId, setMomentoId] = useState('')
  const [docenteResponsableId, setDocenteResponsableId] = useState('')
  const [estudianteId, setEstudianteId] = useState('')
  const [cantidad, setCantidad] = useState('10')

  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [materias, setMaterias] = useState<Materia[]>([])
  const [momentos, setMomentos] = useState<Momento[]>([])

  useEffect(() => {
    const ac = new AbortController()
    async function loadCatalogs() {
      try {
        setCatalogError(null)
        const [p, m, mo] = await Promise.all([
          apiGetJson<Periodo[]>('/api/periodos', ac.signal),
          apiGetJson<Materia[]>('/api/materias', ac.signal),
          apiGetJson<Momento[]>('/api/momentos', ac.signal),
        ])
        setPeriodos(Array.isArray(p) ? p : [])
        setMaterias(Array.isArray(m) ? m : [])
        setMomentos(Array.isArray(mo) ? mo : [])
      } catch (e: any) {
        setCatalogError(e?.message ? String(e.message) : 'No se pudieron cargar los catálogos')
      }
    }
    void loadCatalogs()
    return () => ac.abort()
  }, [])

  const parsed = useMemo(() => {
    return {
      periodoId: toPositiveInt(periodoId),
      materiaId: toPositiveInt(materiaId),
      momentoId: toPositiveInt(momentoId),
      docenteResponsableId: toPositiveInt(docenteResponsableId),
      estudianteId: toPositiveInt(estudianteId),
      cantidad: toPositiveInt(cantidad),
    }
  }, [periodoId, materiaId, momentoId, docenteResponsableId, estudianteId, cantidad])

  const canSubmit =
    !busy &&
    parsed.periodoId &&
    parsed.materiaId &&
    parsed.momentoId &&
    parsed.docenteResponsableId &&
    parsed.estudianteId &&
    parsed.cantidad

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
      <h2>Iniciar examen</h2>
      <p style={{ marginTop: 4, opacity: 0.8 }}>
        Ingresa los IDs para generar el intento.
      </p>

      {catalogError ? (
        <p style={{ marginTop: 8 }}>
          <strong>Catálogos:</strong> {catalogError}
        </p>
      ) : (
        <div style={{ marginTop: 8, opacity: 0.85, fontSize: 14 }}>
          <div>
            <strong>Periodos:</strong>{' '}
            {periodos.length ? periodos.map((p) => `${p.id} (${p.anio} ${p.nombre})`).join(' · ') : '—'}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Materias:</strong>{' '}
            {materias.length ? materias.map((m) => `${m.id} (${m.nombre})`).join(' · ') : '—'}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Momentos:</strong>{' '}
            {momentos.length ? momentos.map((m) => `${m.id} (${m.nombre})`).join(' · ') : '—'}
          </div>
          <div style={{ marginTop: 6 }}>
            Nota: si ves <strong>"Examen not found"</strong>, falta cargar el banco de preguntas para esa configuración
            (periodo/materia/momento/docente).
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label>
          Periodo ID
          <input value={periodoId} onChange={(e) => setPeriodoId(e.target.value)} />
        </label>
        <label>
          Materia ID
          <input value={materiaId} onChange={(e) => setMateriaId(e.target.value)} />
        </label>
        <label>
          Momento ID
          <input value={momentoId} onChange={(e) => setMomentoId(e.target.value)} />
        </label>
        <label>
          Docente responsable ID
          <input
            value={docenteResponsableId}
            onChange={(e) => setDocenteResponsableId(e.target.value)}
          />
        </label>
        <label>
          Estudiante ID
          <input value={estudianteId} onChange={(e) => setEstudianteId(e.target.value)} />
        </label>
        <label>
          Cantidad preguntas
          <input value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </label>
      </div>

      {error ? (
        <p style={{ marginTop: 12 }}>
          <strong>Error:</strong>{' '}
          {error.includes('Examen not found')
            ? `${error} — Primero carga preguntas con POST /api/examenes/banco (y asegúrate de que el docente esté asociado a la materia).`
            : error}
        </p>
      ) : null}

      <button
        style={{ marginTop: 16 }}
        disabled={!canSubmit}
        onClick={() =>
          onStart({
            periodoId: parsed.periodoId!,
            materiaId: parsed.materiaId!,
            momentoId: parsed.momentoId!,
            docenteResponsableId: parsed.docenteResponsableId!,
            estudianteId: parsed.estudianteId!,
            cantidad: parsed.cantidad!,
          })
        }
      >
        {busy ? 'Iniciando…' : 'Iniciar'}
      </button>
    </div>
  )
}
