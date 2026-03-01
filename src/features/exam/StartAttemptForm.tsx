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
type Docente = { id: number; nombres: string; apellidos: string; documento: string; activo: boolean }
type Estudiante = { id: number; nombres: string; apellidos: string; documento: string; activo: boolean }

function extractErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback
  const msg = (err as Record<string, unknown>).message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (msg == null) return fallback
  return String(msg)
}

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

  const [docenteQuery, setDocenteQuery] = useState('')
  const [estudianteQuery, setEstudianteQuery] = useState('')

  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [materias, setMaterias] = useState<Materia[]>([])
  const [momentos, setMomentos] = useState<Momento[]>([])
  const [docentes, setDocentes] = useState<Docente[]>([])
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([])

  useEffect(() => {
    const ac = new AbortController()
    async function loadCatalogs() {
      try {
        setCatalogError(null)
        const [p, m, mo, d, e] = await Promise.all([
          apiGetJson<Periodo[]>('/api/periodos', ac.signal),
          apiGetJson<Materia[]>('/api/materias', ac.signal),
          apiGetJson<Momento[]>('/api/momentos', ac.signal),
          apiGetJson<Docente[]>('/api/docentes', ac.signal),
          apiGetJson<Estudiante[]>('/api/estudiantes', ac.signal),
        ])
        setPeriodos(Array.isArray(p) ? p : [])
        setMaterias(Array.isArray(m) ? m : [])
        setMomentos(Array.isArray(mo) ? mo : [])
        setDocentes(Array.isArray(d) ? d : [])
        setEstudiantes(Array.isArray(e) ? e : [])
      } catch (e: unknown) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          return
        }
        setCatalogError(extractErrorMessage(e, 'No se pudieron cargar los catálogos'))
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

  const docentesForMateria = useMemo(() => {
    if (!parsed.materiaId) return docentes
    const materia = materias.find((m) => m.id === parsed.materiaId)
    const allowed = new Set((materia?.docenteIds ?? []).map((id) => Number(id)))
    if (!allowed.size) return []
    return docentes.filter((d) => allowed.has(d.id))
  }, [docentes, materias, parsed.materiaId])

  const docentesFiltered = useMemo(() => {
    const base = (parsed.materiaId ? docentesForMateria : docentes).filter((d) => Boolean(d?.activo))
    const q = docenteQuery.trim().toLowerCase()
    if (!q) return base
    return base.filter((d) => {
      const fullName = `${d.nombres} ${d.apellidos}`.toLowerCase()
      const doc = (d.documento ?? '').toLowerCase()
      return fullName.includes(q) || doc.includes(q)
    })
  }, [docenteQuery, docentes, docentesForMateria, parsed.materiaId])

  const estudiantesActivos = useMemo(() => {
    const list = estudiantes.filter((e) => Boolean(e?.activo))
    return list.length ? list : estudiantes
  }, [estudiantes])

  const estudiantesFiltered = useMemo(() => {
    const base = estudiantesActivos
    const q = estudianteQuery.trim().toLowerCase()
    if (!q) return base
    return base.filter((e) => {
      const fullName = `${e.nombres} ${e.apellidos}`.toLowerCase()
      const doc = (e.documento ?? '').toLowerCase()
      return fullName.includes(q) || doc.includes(q)
    })
  }, [estudianteQuery, estudiantesActivos])

  const canSubmit =
    !busy &&
    parsed.periodoId &&
    parsed.materiaId &&
    parsed.momentoId &&
    parsed.docenteResponsableId &&
    parsed.estudianteId &&
    parsed.cantidad

  const displayError = useMemo(() => {
    if (!error) return null
    if (error.includes('Examen not found')) {
      return 'No se pudo iniciar el examen con la configuración seleccionada. Verifica la selección o contacta al docente.'
    }
    return error
  }, [error])

  useEffect(() => {
    if (!error) return
    if (error.includes('Examen not found')) {
      // Detalle técnico solo para soporte/debug.
      console.warn('[WiseGrade] Intento iniciar: backend respondió Examen not found:', error)
    }
  }, [error])

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'left' }}>
      <div className="card stack">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Iniciar examen</h2>
          <p className="muted" style={{ marginTop: 3, marginBottom: 0, fontSize: 13 }}>
            Selecciona la configuración para generar el intento.
          </p>
        </div>

        {catalogError ? (
          <p style={{ margin: 0 }}>
            <strong>Catálogos:</strong> {catalogError}
          </p>
        ) : null}

        <div className="formGrid">
          <div className="field">
            <label>Periodo</label>
            <select value={periodoId} onChange={(e) => setPeriodoId(e.target.value)}>
              <option value="">Selecciona un periodo…</option>
              {periodos.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.id} — {p.anio} {p.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Materia</label>
            <select
              value={materiaId}
              onChange={(e) => {
                const next = e.target.value
                setMateriaId(next)

                const nextMateriaId = toPositiveInt(next)
                if (!nextMateriaId) return

                const materia = materias.find((m) => m.id === nextMateriaId)
                const allowed = new Set((materia?.docenteIds ?? []).map((id) => Number(id)))
                if (!allowed.size) {
                  setDocenteResponsableId('')
                  return
                }

                const selected = toPositiveInt(docenteResponsableId)
                if (selected && !allowed.has(selected)) {
                  setDocenteResponsableId('')
                }
              }}
            >
              <option value="">Selecciona una materia…</option>
              {materias.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.id} — {m.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Momento</label>
            <select value={momentoId} onChange={(e) => setMomentoId(e.target.value)}>
              <option value="">Selecciona un momento…</option>
              {momentos.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.id} — {m.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Docente responsable</label>
            <input
              value={docenteQuery}
              onChange={(e) => setDocenteQuery(e.target.value)}
              placeholder="Buscar docente por nombre o documento…"
              disabled={Boolean(parsed.materiaId) && docentesForMateria.length === 0}
            />
            <select
              value={docenteResponsableId}
              onChange={(e) => setDocenteResponsableId(e.target.value)}
              disabled={Boolean(parsed.materiaId) && docentesForMateria.length === 0}
            >
              <option value="">
                {parsed.materiaId && docentesForMateria.length === 0
                  ? 'No hay docentes asociados a esta materia'
                  : 'Selecciona un docente…'}
              </option>
              {docentesFiltered.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.id} — {d.nombres} {d.apellidos}
                </option>
              ))}
            </select>
            {parsed.materiaId && docentesForMateria.length === 0 ? (
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                Para presentar examen, primero asocia docentes a la materia en el backend.
              </div>
            ) : null}
          </div>

          <div className="field">
            <label>Estudiante</label>
            <input
              value={estudianteQuery}
              onChange={(e) => setEstudianteQuery(e.target.value)}
              placeholder="Buscar estudiante por nombre o documento…"
            />
            <select value={estudianteId} onChange={(e) => setEstudianteId(e.target.value)}>
              <option value="">Selecciona un estudiante…</option>
              {estudiantesFiltered.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.id} — {e.nombres} {e.apellidos}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Cantidad de preguntas</label>
            <select value={cantidad} onChange={(e) => setCantidad(e.target.value)}>
              {[10, 15, 20, 30].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {displayError ? (
          <p style={{ margin: 0 }}>
            <strong>Error:</strong>{' '}
            {displayError}
          </p>
        ) : null}

        <div className="row startActions">
          <button
            className="startButton"
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
      </div>
    </div>
  )
}
