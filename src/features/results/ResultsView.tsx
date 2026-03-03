import { useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGetJson } from '../../lib/api'
import type { ExamenResultadosResponse } from './types'

type Periodo = { id: number; anio: number; nombre: string }
type Materia = { id: number; nombre: string; nivelId: number; docenteIds: number[] }
type Momento = { id: number; nombre: string }
type Docente = { id: number; nombres: string; apellidos: string; documento: string; activo: boolean }

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

function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return ''
  // Spring LocalDateTime typically arrives without timezone; display as-is.
  return value.replace('T', ' ')
}

function formatLocalDateTimeHM(value: string | null | undefined): string {
  const raw = formatLocalDateTime(value)
  if (!raw) return ''
  // Expecting "YYYY-MM-DD HH:mm:ss..."; keep only date + hour:minute.
  return raw.length >= 16 ? raw.slice(0, 16) : raw
}

function calcResultsPageSize(viewportWidth: number, viewportHeight: number): 10 | 15 {
  // Keep it intentionally simple: prefer 15 only on large screens.
  if (viewportWidth >= 900 && viewportHeight >= 900) return 15
  return 10
}

function escapeCsv(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (/[\n\r",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function downloadCsv(filename: string, rows: Array<Array<unknown>>) {
  const lines = rows.map((r) => r.map(escapeCsv).join(','))
  // Add BOM for Excel compatibility.
  const csv = `\ufeff${lines.join('\n')}\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

type Props = {
  lockedDocenteId?: number | null
  rol?: 'ADMIN' | 'DOCENTE'
}

export function ResultsView({ lockedDocenteId, rol }: Props) {
  const [periodoId, setPeriodoId] = useState('')
  const [materiaId, setMateriaId] = useState('')
  const [momentoId, setMomentoId] = useState('')
  const [docenteResponsableId, setDocenteResponsableId] = useState('')

  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [materias, setMaterias] = useState<Materia[]>([])
  const [momentos, setMomentos] = useState<Momento[]>([])
  const [docentes, setDocentes] = useState<Docente[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [data, setData] = useState<ExamenResultadosResponse | null>(null)

  const [deletingIntentoId, setDeletingIntentoId] = useState<number | null>(null)

  const [viewport, setViewport] = useState(() => {
    if (typeof window === 'undefined') return { w: 1024, h: 768 }
    return { w: window.innerWidth, h: window.innerHeight }
  })

  const pageSize = useMemo(() => {
    return calcResultsPageSize(viewport.w, viewport.h)
  }, [viewport.h, viewport.w])

  const [page, setPage] = useState(1)

  useEffect(() => {
    const ac = new AbortController()
    async function loadCatalogs() {
      try {
        setCatalogError(null)
        const [p, m, mo, d] = await Promise.all([
          apiGetJson<Periodo[]>('/periodos', ac.signal),
          apiGetJson<Materia[]>('/materias', ac.signal),
          apiGetJson<Momento[]>('/momentos', ac.signal),
          apiGetJson<Docente[]>('/docentes', ac.signal),
        ])
        setPeriodos(Array.isArray(p) ? p : [])
        setMaterias(Array.isArray(m) ? m : [])
        setMomentos(Array.isArray(mo) ? mo : [])
        setDocentes(Array.isArray(d) ? d : [])
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

  useEffect(() => {
    if (!lockedDocenteId) return
    setDocenteResponsableId(String(lockedDocenteId))
  }, [lockedDocenteId])

  useEffect(() => {
    function onResize() {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const parsed = useMemo(() => {
    return {
      periodoId: toPositiveInt(periodoId),
      materiaId: toPositiveInt(materiaId),
      momentoId: toPositiveInt(momentoId),
      docenteResponsableId: toPositiveInt(docenteResponsableId),
    }
  }, [periodoId, materiaId, momentoId, docenteResponsableId])

  const docentesForMateria = useMemo(() => {
    if (!parsed.materiaId) return docentes
    const materia = materias.find((m) => m.id === parsed.materiaId)
    const allowed = new Set((materia?.docenteIds ?? []).map((id) => Number(id)))
    if (!allowed.size) return []
    return docentes.filter((d) => allowed.has(d.id))
  }, [docentes, materias, parsed.materiaId])

  const docentesActivos = useMemo(() => {
    const base = (parsed.materiaId ? docentesForMateria : docentes)
    const activos = base.filter((d) => Boolean(d?.activo))
    return activos.length ? activos : base
  }, [docentes, docentesForMateria, parsed.materiaId])

  const canQuery =
    !busy && parsed.periodoId && parsed.materiaId && parsed.momentoId && parsed.docenteResponsableId

  const selectedMateriaNombre = useMemo(() => {
    if (!parsed.materiaId) return null
    return materias.find((m) => m.id === parsed.materiaId)?.nombre ?? null
  }, [materias, parsed.materiaId])

  async function handleQuery() {
    if (!canQuery) return

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const qs = new URLSearchParams({
        periodoId: String(parsed.periodoId),
        materiaId: String(parsed.materiaId),
        momentoId: String(parsed.momentoId),
        docenteResponsableId: String(parsed.docenteResponsableId),
        includeInProgress: 'true',
      })

      const res = await apiGetJson<ExamenResultadosResponse>(`/examenes/resultados?${qs.toString()}`)
      setData(res)
      setPage(1)
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'No se pudieron cargar los resultados'))
      setData(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteIntento(params: {
    intentoId: number
    estado: string
    estudianteNombre: string
    documento: string
  }) {
    const { intentoId, estado, estudianteNombre, documento } = params
    if (!intentoId || busy || deletingIntentoId != null) return

    const ok = window.confirm(
      `¿Eliminar el intento ${intentoId} (${estado}) del estudiante ${estudianteNombre} (${documento})?\n\nEsta acción eliminará también las preguntas del intento y no se puede deshacer.`,
    )
    if (!ok) return

    setDeletingIntentoId(intentoId)
    setError(null)
    setNotice(null)
    try {
      await apiDelete(`/intentos/${intentoId}`)
      await handleQuery()
      setNotice({ kind: 'success', message: `Intento ${intentoId} eliminado con éxito.` })
    } catch (e: unknown) {
      const msg = extractErrorMessage(e, 'No se pudo eliminar el intento')
      setNotice({ kind: 'error', message: `La eliminación falló: ${msg}` })
    } finally {
      setDeletingIntentoId(null)
    }
  }

  const filas = useMemo(() => {
    return data?.filas ?? []
  }, [data])
  const totalPages = useMemo(() => {
    const n = Math.ceil(filas.length / pageSize)
    return Math.max(1, n)
  }, [filas.length, pageSize])

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages))
  }, [totalPages])

  const pagedFilas = useMemo(() => {
    const start = (page - 1) * pageSize
    return filas.slice(start, start + pageSize)
  }, [filas, page, pageSize])

  const canExport = Boolean(data && filas.length > 0)

  return (
    <div className="resultsContainer">
      <div className="card stack resultsCard">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Resultados</h2>
          <p className="muted" style={{ marginTop: 3, marginBottom: 0, fontSize: 13 }}>
            Consulta los intentos para una configuración.
          </p>
        </div>

        {catalogError ? (
          <p style={{ margin: 0 }}>
            <strong>Catálogos:</strong> {catalogError}
          </p>
        ) : null}

        <div className="resultsFiltersGrid">
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
                  if (!lockedDocenteId) setDocenteResponsableId('')
                  return
                }

                const selected = toPositiveInt(docenteResponsableId)
                if (selected && !allowed.has(selected)) {
                  if (!lockedDocenteId) setDocenteResponsableId('')
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
            <select
              value={docenteResponsableId}
              onChange={(e) => setDocenteResponsableId(e.target.value)}
              disabled={Boolean(lockedDocenteId) || (Boolean(parsed.materiaId) && docentesForMateria.length === 0)}
            >
              <option value="">
                {parsed.materiaId && docentesForMateria.length === 0
                  ? 'No hay docentes asociados a esta materia'
                  : 'Selecciona un docente…'}
              </option>
              {docentesActivos.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.id} — {d.nombres} {d.apellidos}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <p style={{ margin: 0 }}>
            <strong>Error:</strong> {error}
          </p>
        ) : null}

        {notice ? (
          <p style={{ margin: 0 }}>
            <strong>{notice.kind === 'success' ? 'Éxito:' : 'Error:'}</strong> {notice.message}
          </p>
        ) : null}

        <div className="row" style={{ justifyContent: 'center' }}>
          <button onClick={handleQuery} disabled={!canQuery} className="btnSecondary">
            {busy ? 'Consultando…' : 'Consultar'}
          </button>
        </div>

        {data ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="card" style={{ padding: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 800 }}>{selectedMateriaNombre ? `Examen: ${selectedMateriaNombre}` : 'Examen'}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    ID Examen: {data.examenId}
                  </div>
                </div>
                <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Filas: {filas.length}
                  </div>
                  <button
                    type="button"
                    className="btnSecondary headerBtn"
                    disabled={!canExport}
                    onClick={() => {
                      if (!data) return
                      const rows: Array<Array<unknown>> = [
                        ['Documento', 'Estudiante', 'Estado', 'Nota', 'Inicio', 'Envío', 'No Examen'],
                        ...filas.map((f) => {
                          const est = f.estudiante
                          const estudianteNombre = `${est.nombres} ${est.apellidos}`
                          const nota = typeof f.resultado?.notaSobre5 === 'number' ? f.resultado.notaSobre5.toFixed(2) : ''
                          return [
                            est.documento,
                            estudianteNombre,
                            f.estado,
                            nota,
                            formatLocalDateTimeHM(f.startedAt),
                            formatLocalDateTimeHM(f.submittedAt),
                            f.intentoId,
                          ]
                        }),
                      ]

                      const safeMateria = (selectedMateriaNombre ?? 'examen').replace(/[^a-z0-9_-]+/gi, '_')
                      downloadCsv(`resultados-${safeMateria}-examen-${data.examenId}.csv`, rows)
                    }}
                  >
                    Exportar Excel (CSV)
                  </button>
                </div>
              </div>
            </div>

            {filas.length > 0 ? (
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div className="muted" style={{ fontSize: 13 }}>
                  Página {page} de {totalPages} · {pageSize} por página
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="btnSecondary headerBtn"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="btnSecondary headerBtn"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            ) : null}

            <div className="card" style={{ padding: 8, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '26%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>Documento</th>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>Estudiante</th>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>Estado</th>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>Nota</th>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>Inicio</th>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>Envío</th>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>No Examen</th>
                    <th style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedFilas.map((f) => {
                    const est = f.estudiante
                    const estudianteNombre = `${est.nombres} ${est.apellidos}`
                    const nota = typeof f.resultado?.notaSobre5 === 'number' ? f.resultado.notaSobre5.toFixed(2) : ''

                    const canDelete =
                      (rol === 'ADMIN') ||
                      (rol === 'DOCENTE' && f.estado !== 'SUBMITTED')
                    const isDeleting = deletingIntentoId === f.intentoId
                    return (
                      <tr key={f.intentoId}>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)', whiteSpace: 'nowrap' }}>
                          {est.documento}
                        </td>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)' }}>
                          <div
                            title={estudianteNombre}
                            style={{
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {estudianteNombre}
                          </div>
                        </td>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)', whiteSpace: 'nowrap' }}>
                          {f.estado}
                        </td>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)', fontWeight: 800, whiteSpace: 'nowrap' }}>
                          {nota}
                        </td>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)', whiteSpace: 'nowrap' }}>
                          {formatLocalDateTimeHM(f.startedAt)}
                        </td>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)', whiteSpace: 'nowrap' }}>
                          {formatLocalDateTimeHM(f.submittedAt)}
                        </td>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)', whiteSpace: 'nowrap' }}>
                          {f.intentoId}
                        </td>
                        <td style={{ padding: '6px 6px', borderBottom: '1px solid var(--wg-border)', whiteSpace: 'nowrap' }}>
                          {canDelete ? (
                            <button
                              type="button"
                              className="btnSecondary headerBtn"
                              disabled={busy || deletingIntentoId != null}
                              onClick={() =>
                                handleDeleteIntento({
                                  intentoId: f.intentoId,
                                  estado: f.estado,
                                  estudianteNombre,
                                  documento: est.documento,
                                })
                              }
                              title={f.estado === 'SUBMITTED' ? 'Solo ADMIN puede eliminar SUBMITTED' : 'Eliminar intento'}
                            >
                              {isDeleting ? 'Eliminando…' : 'Eliminar'}
                            </button>
                          ) : (
                            ''
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {filas.length === 0 ? (
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                  No hay intentos para esta configuración.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
