import { useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGetJson, apiPostJson, apiPut } from '../../lib/api'
import type { ExamenResultadosResponse } from './types'

type Periodo = { id: number; anio: number; nombre: string }
type Materia = { id: number; nombre: string; nivelId: number; docenteIds: number[] }
type Momento = { id: number; nombre: string }
type Docente = { id: number; nombres: string; apellidos: string; documento: string; activo: boolean }

type RespuestaCorrecta = 'A' | 'B' | 'C' | 'D'

type PreguntaCreateRequest = {
  enunciado: string
  opcionA: string
  opcionB: string
  opcionC: string
  opcionD: string
  correcta: RespuestaCorrecta
  explicacion?: string | null
}

type ExamenBankLoadRequest = {
  periodoId: number
  materiaId: number
  momentoId: number
  docenteResponsableId: number
  preguntas: PreguntaCreateRequest[]
}

type ExamenBankLoadResponse = {
  examenId: number
  preguntasRecibidas: number
  preguntasAgregadas: number
  preguntasOmitidas: number
  totalBanco: number
}

type ExamenEnsureResponse = {
  examenId: number
  created: boolean
  totalBanco: number
}

type EstudianteCreateRequest = {
  nombres: string
  apellidos: string
  documento: string
  activo: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string') return v
  }
  return null
}

function normalizeNonEmpty(value: string | null, field: string, index: number): string {
  const s = (value ?? '').trim()
  if (!s) throw new Error(`Pregunta #${index + 1}: falta campo ${field}`)
  return s
}

function parseCorrecta(value: string | null, index: number): RespuestaCorrecta {
  const raw = (value ?? '').trim().toUpperCase()
  if (raw === 'A' || raw === 'B' || raw === 'C' || raw === 'D') return raw
  throw new Error(`Pregunta #${index + 1}: campo correcta inválido (${raw || 'vacío'})`)
}

function parsePreguntasJson(raw: unknown): PreguntaCreateRequest[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.preguntas)
      ? (raw.preguntas as unknown[])
      : []

  if (!items.length) {
    throw new Error('El JSON debe ser un arreglo de preguntas o un objeto con propiedad preguntas[].')
  }

  return items.map((item, i) => {
    if (!isRecord(item)) throw new Error(`Pregunta #${i + 1}: objeto inválido`)

    const enunciado = normalizeNonEmpty(pickString(item, ['enunciado']), 'enunciado', i)

    const opcionA = normalizeNonEmpty(pickString(item, ['opcionA', 'opcion_a']), 'opcionA/opcion_a', i)
    const opcionB = normalizeNonEmpty(pickString(item, ['opcionB', 'opcion_b']), 'opcionB/opcion_b', i)
    const opcionC = normalizeNonEmpty(pickString(item, ['opcionC', 'opcion_c']), 'opcionC/opcion_c', i)
    const opcionD = normalizeNonEmpty(pickString(item, ['opcionD', 'opcion_d']), 'opcionD/opcion_d', i)

    const correcta = parseCorrecta(pickString(item, ['correcta']), i)
    const explicacionRaw = pickString(item, ['explicacion'])
    const explicacion = explicacionRaw != null ? explicacionRaw.trim() : null

    return {
      enunciado,
      opcionA,
      opcionB,
      opcionC,
      opcionD,
      correcta,
      explicacion,
    }
  })
}

function normalizeNonEmptyStr(value: unknown, field: string, index: number): string {
  const s = String(value ?? '').trim()
  if (!s) throw new Error(`Estudiante #${index + 1}: falta campo ${field}`)
  return s
}

function toBooleanActivo(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const s = String(value).trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'si' || s === 'sí') return true
  if (s === '0' || s === 'false' || s === 'no') return false
  return true
}

function parseEstudiantesJson(raw: unknown): EstudianteCreateRequest[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.estudiantes)
      ? (raw.estudiantes as unknown[])
      : []

  if (!items.length) {
    throw new Error('El JSON debe ser un arreglo de estudiantes o un objeto con propiedad estudiantes[].')
  }

  const seenDocumentos = new Set<string>()
  const out: EstudianteCreateRequest[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!isRecord(item)) throw new Error(`Estudiante #${i + 1}: objeto inválido`)

    const nombres = normalizeNonEmptyStr(item.nombres, 'nombres', i)
    const apellidos = normalizeNonEmptyStr(item.apellidos, 'apellidos', i)
    const documento = normalizeNonEmptyStr(item.documento, 'documento', i)
    const activo = toBooleanActivo(item.activo)

    if (seenDocumentos.has(documento)) {
      continue
    }
    seenDocumentos.add(documento)
    out.push({ nombres, apellidos, documento, activo })
  }

  return out
}

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

type EstadoIntentoFiltro = 'TODOS' | 'ENVIADOS' | 'EN_PROGRESO'

export function ResultsView({ lockedDocenteId, rol }: Props) {
  const [periodoId, setPeriodoId] = useState('')
  const [materiaId, setMateriaId] = useState('')
  const [momentoId, setMomentoId] = useState('')
  const [docenteResponsableId, setDocenteResponsableId] = useState('')

  const [estadoFiltro, setEstadoFiltro] = useState<EstadoIntentoFiltro>('TODOS')

  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [studentsFile, setStudentsFile] = useState<File | null>(null)
  const [studentsBusy, setStudentsBusy] = useState(false)
  const [studentsError, setStudentsError] = useState<string | null>(null)

  const [ensuring, setEnsuring] = useState(false)
  const [ensureError, setEnsureError] = useState<string | null>(null)
  const [ensuredExamenId, setEnsuredExamenId] = useState<number | null>(null)

  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [materias, setMaterias] = useState<Materia[]>([])
  const [momentos, setMomentos] = useState<Momento[]>([])
  const [docentes, setDocentes] = useState<Docente[]>([])

  const [associateDocenteId, setAssociateDocenteId] = useState('')
  const [associating, setAssociating] = useState(false)
  const [associateError, setAssociateError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [data, setData] = useState<ExamenResultadosResponse | null>(null)

  const [deletingIntentoId, setDeletingIntentoId] = useState<number | null>(null)

  const [confirmDelete, setConfirmDelete] = useState<{
    intentoId: number
    estado: string
    estudianteNombre: string
    documento: string
  } | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(t)
  }, [toast])

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

  const allDocentesActivos = useMemo(() => {
    const activos = docentes.filter((d) => Boolean(d?.activo))
    return activos.length ? activos : docentes
  }, [docentes])

  const canQuery =
    !busy && parsed.periodoId && parsed.materiaId && parsed.momentoId && parsed.docenteResponsableId

  const canUpload =
    !busy &&
    !uploadBusy &&
    Boolean(uploadFile) &&
    (Boolean(ensuredExamenId) || Boolean(data?.examenId)) &&
    parsed.periodoId &&
    parsed.materiaId &&
    parsed.momentoId &&
    parsed.docenteResponsableId

  const ensureDisabledReason = useMemo(() => {
    if (busy) return 'Espera a que termine la consulta.'
    if (uploadBusy) return 'Espera a que termine la carga de preguntas.'
    if (ensuring) return 'Creación de examen en curso.'
    if (!parsed.periodoId) return 'Selecciona un periodo para poder crear el examen.'
    if (!parsed.materiaId) return 'Selecciona una materia para poder crear el examen.'
    if (!parsed.momentoId) return 'Selecciona un momento para poder crear el examen.'
    if (rol === 'ADMIN' && parsed.materiaId && docentesForMateria.length === 0) {
      return 'La materia no tiene docentes asociados. Asocia un docente a la materia para poder crear el examen.'
    }
    if (!parsed.docenteResponsableId) return 'Selecciona un docente responsable para poder crear el examen.'
    return null
  }, [busy, docentesForMateria.length, ensuring, parsed.docenteResponsableId, parsed.materiaId, parsed.momentoId, parsed.periodoId, rol, uploadBusy])

  const canEnsure = ensureDisabledReason == null

  const selectedMateriaNombre = useMemo(() => {
    if (!parsed.materiaId) return null
    return materias.find((m) => m.id === parsed.materiaId)?.nombre ?? null
  }, [materias, parsed.materiaId])

  async function handleQuery() {
    if (!canQuery) return

    setBusy(true)
    setError(null)

    try {
      const includeInProgress = estadoFiltro !== 'ENVIADOS'
      const qs = new URLSearchParams({
        periodoId: String(parsed.periodoId),
        materiaId: String(parsed.materiaId),
        momentoId: String(parsed.momentoId),
        docenteResponsableId: String(parsed.docenteResponsableId),
        includeInProgress: includeInProgress ? 'true' : 'false',
      })

      const res = await apiGetJson<ExamenResultadosResponse>(`/examenes/resultados?${qs.toString()}`)
      setData(res)
      setEnsuredExamenId(res?.examenId ?? null)
      setPage(1)
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'No se pudieron cargar los resultados'))
      setData(null)
      // If the exam does not exist yet, keep ensuredExamenId null.
      if (extractErrorStatus(e) === 404) {
        setEnsuredExamenId(null)
      }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [estadoFiltro])

  async function handleEnsureExam() {
    if (!canEnsure) return

    setEnsuring(true)
    setEnsureError(null)
    setToast(null)

    try {
      const payload = {
        periodoId: parsed.periodoId as number,
        materiaId: parsed.materiaId as number,
        momentoId: parsed.momentoId as number,
        docenteResponsableId: parsed.docenteResponsableId as number,
      }

      const res = await apiPostJson<ExamenEnsureResponse>('/examenes/asegurar', payload)
      setEnsuredExamenId(res.examenId)

      setToast({
        kind: 'success',
        message: res.created
          ? `Examen creado con éxito (ID ${res.examenId}). Banco actual: ${res.totalBanco}.`
          : `Examen ya existía (ID ${res.examenId}). Banco actual: ${res.totalBanco}.`,
      })

      // Best-effort refresh so the exam becomes visible in the view.
      await handleQuery()
    } catch (e: unknown) {
      const msg = extractErrorMessage(e, 'No se pudo crear el examen')
      setEnsureError(msg)
      setToast({ kind: 'error', message: `Crear examen falló: ${msg}` })
    } finally {
      setEnsuring(false)
    }
  }

  async function handleAssociateDocenteToMateria() {
    if (busy || uploadBusy || ensuring || associating) return
    if (rol !== 'ADMIN') return
    if (!parsed.materiaId) return

    const docenteId = toPositiveInt(associateDocenteId)
    if (!docenteId) {
      setAssociateError('Selecciona un docente para asociar a la materia.')
      return
    }

    setAssociating(true)
    setAssociateError(null)
    setToast(null)

    try {
      await apiPut(`/materias/${parsed.materiaId}/docentes/${docenteId}`)

      // Refresh materias so docenteIds are updated.
      const refreshedMaterias = await apiGetJson<Materia[]>('/materias')
      setMaterias(Array.isArray(refreshedMaterias) ? refreshedMaterias : [])

      setDocenteResponsableId(String(docenteId))
      setToast({ kind: 'success', message: 'Docente asociado a la materia. Ya puedes crear el examen.' })
    } catch (e: unknown) {
      const msg = extractErrorMessage(e, 'No se pudo asociar el docente a la materia')
      setAssociateError(msg)
      setToast({ kind: 'error', message: `Asociación falló: ${msg}` })
    } finally {
      setAssociating(false)
    }
  }

  async function handleUploadBank() {
    if (!canUpload || !uploadFile) return

    setUploadBusy(true)
    setUploadError(null)
    setToast(null)

    try {
      const text = await uploadFile.text()
      const raw = JSON.parse(text) as unknown
      const preguntas = parsePreguntasJson(raw)

      const payload: ExamenBankLoadRequest = {
        periodoId: parsed.periodoId as number,
        materiaId: parsed.materiaId as number,
        momentoId: parsed.momentoId as number,
        docenteResponsableId: parsed.docenteResponsableId as number,
        preguntas,
      }

      const res = await apiPostJson<ExamenBankLoadResponse>('/examenes/banco', payload)

      setToast({
        kind: 'success',
        message: `Banco cargado. Examen ${res.examenId}: +${res.preguntasAgregadas} (omitidas ${res.preguntasOmitidas}), total ${res.totalBanco}.`,
      })
    } catch (e: unknown) {
      const msg = extractErrorMessage(e, 'No se pudo cargar el banco')
      setUploadError(msg)
      setToast({ kind: 'error', message: `La carga falló: ${msg}` })
    } finally {
      setUploadBusy(false)
    }
  }

  async function handleUploadStudents() {
    if (rol !== 'ADMIN') return
    if (!studentsFile) {
      setStudentsError('Selecciona un archivo JSON de estudiantes.')
      return
    }
    if (studentsBusy || busy || uploadBusy || ensuring || associating) return

    setStudentsBusy(true)
    setStudentsError(null)
    setToast(null)

    try {
      const text = await studentsFile.text()
      const raw = JSON.parse(text) as unknown
      const estudiantes = parseEstudiantesJson(raw)

      const existentes = await apiGetJson<Array<{ documento?: string | null }>>('/estudiantes')
      const documentosExistentes = new Set(
        (Array.isArray(existentes) ? existentes : [])
          .map((e) => String(e?.documento ?? '').trim())
          .filter((d) => d),
      )

      let received = estudiantes.length
      let added = 0
      let skipped = 0
      let errors = 0

      for (const e of estudiantes) {
        if (documentosExistentes.has(e.documento)) {
          skipped++
          continue
        }

        try {
          await apiPostJson('/estudiantes', e)
          added++
          documentosExistentes.add(e.documento)
        } catch (err: unknown) {
          const status = extractErrorStatus(err)
          if (status === 409) {
            skipped++
            documentosExistentes.add(e.documento)
            continue
          }
          errors++
        }
      }

      setToast({
        kind: errors ? 'error' : 'success',
        message: `Carga estudiantes: recibidos ${received}, agregados ${added}, omitidos ${skipped}, errores ${errors}.`,
      })
    } catch (e: unknown) {
      const msg = extractErrorMessage(e, 'No se pudo cargar el archivo de estudiantes')
      setStudentsError(msg)
      setToast({ kind: 'error', message: `Carga estudiantes falló: ${msg}` })
    } finally {
      setStudentsBusy(false)
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

    setConfirmDelete({ intentoId, estado, estudianteNombre, documento })
  }

  async function confirmDeleteIntento() {
    const params = confirmDelete
    if (!params) return
    const { intentoId } = params
    if (!intentoId || busy || deletingIntentoId != null) return

    setDeletingIntentoId(intentoId)
    setError(null)
    setToast(null)
    setConfirmDelete(null)

    try {
      await apiDelete(`/intentos/${intentoId}`)

      // Optimistic UI: remove the row immediately even if refresh cannot run.
      setData((prev) => {
        if (!prev) return prev
        return { ...prev, filas: (prev.filas ?? []).filter((f) => f.intentoId !== intentoId) }
      })

      // Best-effort refresh (keeps server as source of truth), but don't depend on it for feedback.
      await handleQuery()

      setToast({ kind: 'success', message: `Intento ${intentoId} eliminado con éxito.` })
    } catch (e: unknown) {
      const msg = extractErrorMessage(e, 'No se pudo eliminar el intento')
      setToast({ kind: 'error', message: `La eliminación falló: ${msg}` })
    } finally {
      setDeletingIntentoId(null)
    }
  }

  const filas = useMemo(() => {
    const all = data?.filas ?? []
    if (estadoFiltro === 'TODOS') return all
    if (estadoFiltro === 'ENVIADOS') return all.filter((f) => f.estado === 'SUBMITTED')
    return all.filter((f) => f.estado === 'IN_PROGRESS')
  }, [data, estadoFiltro])
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
            <label>Estado</label>
            <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as EstadoIntentoFiltro)}>
              <option value="TODOS">Todos</option>
              <option value="ENVIADOS">Enviados</option>
              <option value="EN_PROGRESO">En progreso</option>
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
                  ? 'La materia no tiene docentes asociados'
                  : 'Selecciona un docente…'}
              </option>
              {docentesActivos.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.id} — {d.nombres} {d.apellidos}
                </option>
              ))}
            </select>

            {rol === 'ADMIN' && parsed.materiaId && docentesForMateria.length === 0 ? (
              <div style={{ marginTop: 8 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  La materia no tiene docentes asociados. Asocia un docente a la materia para poder crear el examen.
                </div>
                <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                  <select
                    value={associateDocenteId}
                    onChange={(e) => setAssociateDocenteId(e.target.value)}
                    disabled={associating || busy || uploadBusy || ensuring}
                  >
                    <option value="">Selecciona un docente para asociar…</option>
                    {allDocentesActivos.map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        {d.id} — {d.nombres} {d.apellidos}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btnSecondary headerBtn"
                    disabled={associating || !toPositiveInt(associateDocenteId)}
                    onClick={handleAssociateDocenteToMateria}
                  >
                    {associating ? 'Asociando…' : 'Asociar'}
                  </button>
                </div>
                {associateError ? (
                  <div style={{ marginTop: 6 }}>
                    <strong>Asociar docente:</strong> {associateError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <p style={{ margin: 0 }}>
            <strong>Error:</strong> {error}
          </p>
        ) : null}

        <div className="card" style={{ padding: 10 }}>
          <div style={{ fontWeight: 800 }}>Cargar preguntas (JSON)</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Acepta snake_case (opcion_a) o camelCase (opcionA). El examen se crea/actualiza con Periodo+Materia+Momento+Docente.
          </div>

          <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btnSecondary headerBtn"
              disabled={!canEnsure}
              onClick={handleEnsureExam}
            >
              {ensuring ? 'Creando…' : 'Crear examen'}
            </button>
            <div className="muted" style={{ fontSize: 12 }}>
              {ensuredExamenId || data?.examenId
                ? `Examen ID: ${ensuredExamenId ?? data?.examenId}`
                : 'Aún no existe un examen para esta configuración.'}
              {ensureDisabledReason ? ` ${ensureDisabledReason}` : ' Créalo para habilitar la carga.'}
            </div>
          </div>

          {ensureError ? (
            <p style={{ margin: 0, marginTop: 8 }}>
              <strong>Crear examen:</strong> {ensureError}
            </p>
          ) : null}

          <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              type="file"
              accept="application/json"
              disabled={uploadBusy || busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setUploadFile(f)
                setUploadError(null)
                setToast(null)
              }}
            />
            <button type="button" className="btnSecondary headerBtn" disabled={!canUpload} onClick={handleUploadBank}>
              {uploadBusy ? 'Cargando…' : 'Cargar preguntas'}
            </button>
          </div>

          {!ensuredExamenId && !data?.examenId ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Para cargar preguntas primero debes crear el examen (botón "Crear examen") o consultarlo si ya existe.
            </div>
          ) : null}

          {uploadError ? (
            <p style={{ margin: 0, marginTop: 8 }}>
              <strong>Carga:</strong> {uploadError}
            </p>
          ) : null}

          {rol === 'DOCENTE' ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Nota: como docente, el sistema asocia la carga automáticamente a tu usuario.
            </div>
          ) : null}
        </div>

        {rol === 'ADMIN' ? (
          <div className="card" style={{ padding: 10 }}>
            <div style={{ fontWeight: 800 }}>Cargar estudiantes (JSON)</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Carga masiva de estudiantes. Omite duplicados por documento.
            </div>

            <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                type="file"
                accept="application/json"
                disabled={studentsBusy || busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setStudentsFile(f)
                  setStudentsError(null)
                  setToast(null)
                }}
              />
              <button
                type="button"
                className="btnSecondary headerBtn"
                disabled={!studentsFile || studentsBusy || busy}
                onClick={handleUploadStudents}
              >
                {studentsBusy ? 'Cargando…' : 'Cargar estudiantes'}
              </button>
            </div>

            {studentsError ? (
              <p style={{ margin: 0, marginTop: 8 }}>
                <strong>Carga estudiantes:</strong> {studentsError}
              </p>
            ) : null}
          </div>
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

      {toast ? (
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 1000,
            width: 'min(520px, calc(100vw - 32px))',
          }}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
        >
          <div className="card" style={{ padding: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 2 }}>
                  {toast.kind === 'success' ? 'Éxito' : 'Error'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--wg-text)' }}>{toast.message}</div>
              </div>
              <button
                type="button"
                className="btnSecondary headerBtn"
                onClick={() => setToast(null)}
                disabled={deletingIntentoId != null}
                title="Cerrar"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} role="dialog" aria-modal="true">
          <div style={{ position: 'absolute', inset: 0, background: 'var(--wg-bg)', opacity: 0.85 }} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              padding: 16,
            }}
          >
            <div className="card" style={{ width: 'min(560px, 100%)', padding: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>Confirmar eliminación</div>
              <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Esta acción elimina también las preguntas del intento y no se puede deshacer.
              </div>

              <div style={{ fontSize: 13, marginBottom: 10 }}>
                ¿Eliminar el intento <strong>{confirmDelete.intentoId}</strong> ({confirmDelete.estado}) del estudiante{' '}
                <strong>{confirmDelete.estudianteNombre}</strong> ({confirmDelete.documento})?
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btnSecondary"
                  onClick={() => setConfirmDelete(null)}
                  disabled={deletingIntentoId != null || busy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteIntento}
                  disabled={deletingIntentoId != null || busy}
                  title="Eliminar intento"
                >
                  {deletingIntentoId != null ? 'Eliminando…' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
