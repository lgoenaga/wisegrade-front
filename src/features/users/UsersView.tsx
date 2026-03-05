import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'

import { apiDelete, apiGetJson, apiPostJson, apiPutJson } from '../../lib/api'
import type { UserRole } from '../auth/types'

type AuthUserResponse = {
  id: number
  documento: string
  rol: UserRole
  activo: boolean
  docenteId: number | null
  estudianteId: number | null
}

type AuthUserCreateRequest = {
  documento: string
  clave: string
  rol: UserRole
  activo?: boolean
  docenteId?: number | null
  estudianteId?: number | null
}

type AuthUserUpdateRequest = {
  documento: string
  clave?: string | null
  rol: UserRole
  activo: boolean
  docenteId?: number | null
  estudianteId?: number | null
}

type EstudianteResponse = {
  id: number
  nombres: string
  apellidos: string
  documento: string
  activo: boolean
}

function normalizeLinksForRole(rol: UserRole, docenteId: number | null, estudianteId: number | null) {
  if (rol === 'ADMIN') return { docenteId: null, estudianteId: null }
  if (rol === 'DOCENTE') return { docenteId, estudianteId: null }
  return { docenteId: null, estudianteId }
}

function parseNullableInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function formatEstudianteLabel(e: EstudianteResponse): string {
  const fullName = `${e.nombres ?? ''} ${e.apellidos ?? ''}`.trim()
  return fullName ? `${e.documento} — ${fullName}` : e.documento
}

function matchesEstudiante(e: EstudianteResponse, query: string): boolean {
  const q = normalizeText(query)
  if (!q) return true
  return (
    normalizeText(e.documento).includes(q) ||
    normalizeText(e.nombres).includes(q) ||
    normalizeText(e.apellidos).includes(q) ||
    normalizeText(`${e.nombres} ${e.apellidos}`).includes(q)
  )
}

function EstudianteCombobox({
  disabled,
  required,
  estudiantes,
  selectedId,
  onSelectedId,
  resetKey,
}: {
  disabled: boolean
  required: boolean
  estudiantes: EstudianteResponse[]
  selectedId: number | null
  onSelectedId: (next: number | null) => void
  resetKey?: number
}) {
  const selected = useMemo(
    () => (selectedId == null ? null : estudiantes.find((e) => e.id === selectedId) ?? null),
    [estudiantes, selectedId],
  )
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const lastSelectedIdRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const base = (Array.isArray(estudiantes) ? estudiantes : []).filter((e) => matchesEstudiante(e, query))
    return base.slice(0, 25)
  }, [estudiantes, query])

  useEffect(() => {
    // Keep field text synced when selection changes from outside.
    // If the dropdown is open, user is typing/searching; don't override.
    if (open) return

    if (lastSelectedIdRef.current === selectedId) return
    lastSelectedIdRef.current = selectedId

    if (selectedId == null) {
      setQuery('')
      return
    }

    if (selected) {
      setQuery(formatEstudianteLabel(selected))
    }
  }, [open, selected, selectedId])

  useEffect(() => {
    if (resetKey == null) return
    setQuery('')
    setOpen(false)
  }, [resetKey])

  useEffect(() => {
    if (!disabled) return
    setOpen(false)
  }, [disabled])

  return (
    <div className="field" style={{ position: 'relative', minWidth: 320 }}>
      <label>Estudiante</label>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          onSelectedId(null)
        }}
        onFocus={() => {
          if (!disabled) setOpen(true)
        }}
        onBlur={(e) => {
          const next = e.relatedTarget
          if (next && dropdownRef.current?.contains(next)) return
          setOpen(false)
        }}
        placeholder={disabled ? '—' : 'Digita para buscar…'}
        disabled={disabled}
        aria-required={required}
      />

      {!disabled && open ? (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 6px)',
            background: 'var(--wg-surface)',
            border: '1px solid var(--wg-border)',
            borderRadius: 12,
            padding: 6,
            zIndex: 30,
            maxHeight: 260,
            overflowY: 'auto',
          }}
          role="listbox"
        >
          {filtered.length ? (
            filtered.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  onSelectedId(e.id)
                  setQuery(formatEstudianteLabel(e))
                  setOpen(false)
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: 'var(--wg-text)',
                  cursor: 'pointer',
                }}
                role="option"
              >
                {formatEstudianteLabel(e)}
              </button>
            ))
          ) : (
            <div style={{ padding: '8px 10px', color: 'var(--wg-muted)' }}>Sin resultados</div>
          )}
        </div>
      ) : null}

      {!disabled && required && selectedId == null ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Requerido
        </div>
      ) : null}
    </div>
  )
}

export default function UsersView() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [users, setUsers] = useState<AuthUserResponse[]>([])

  const [documentFilter, setDocumentFilter] = useState('')

  const [estudiantes, setEstudiantes] = useState<EstudianteResponse[]>([])
  const [estudiantesError, setEstudiantesError] = useState<string | null>(null)

  const [createDocumento, setCreateDocumento] = useState('')
  const [createClave, setCreateClave] = useState('')
  const [createRol, setCreateRol] = useState<UserRole>('ESTUDIANTE')
  const [createActivo, setCreateActivo] = useState(true)
  const [createDocenteId, setCreateDocenteId] = useState<string>('')
  const [createEstudianteId, setCreateEstudianteId] = useState<number | null>(null)
  const [createEstudianteResetKey, setCreateEstudianteResetKey] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const selected = useMemo(() => users.find((u) => u.id === selectedId) ?? null, [users, selectedId])

  const [editDocumento, setEditDocumento] = useState('')
  const [editClave, setEditClave] = useState('')
  const [editRol, setEditRol] = useState<UserRole>('ESTUDIANTE')
  const [editActivo, setEditActivo] = useState(true)
  const [editDocenteId, setEditDocenteId] = useState<string>('')
  const [editEstudianteId, setEditEstudianteId] = useState<number | null>(null)

  const filteredUsers = useMemo(() => {
    const q = normalizeText(documentFilter)
    if (!q) return users
    return users.filter((u) => normalizeText(u.documento).includes(q))
  }, [users, documentFilter])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGetJson<AuthUserResponse[]>('/auth/users')
      setUsers(data)
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Error'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    const ac = new AbortController()
    setEstudiantesError(null)

    ;(async () => {
      try {
        const data = await apiGetJson<EstudianteResponse[]>('/estudiantes', ac.signal)
        if (cancelled) return
        setEstudiantes(Array.isArray(data) ? data : [])
      } catch (e) {
        const message = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Error'
        if (cancelled) return
        setEstudiantes([])
        setEstudiantesError(message)
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    setEditDocumento(selected.documento)
    setEditRol(selected.rol)
    setEditActivo(selected.activo)
    setEditClave('')
    setEditDocenteId(selected.docenteId == null ? '' : String(selected.docenteId))
    setEditEstudianteId(selected.estudianteId == null ? null : selected.estudianteId)
  }, [selected])

  useEffect(() => {
    if (createRol !== 'ESTUDIANTE') {
      setCreateEstudianteId(null)
    }
    if (createRol !== 'DOCENTE') {
      setCreateDocenteId('')
    }
  }, [createRol])

  useEffect(() => {
    if (editRol !== 'ESTUDIANTE') {
      setEditEstudianteId(null)
    }
    if (editRol !== 'DOCENTE') {
      setEditDocenteId('')
    }
  }, [editRol])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (createRol === 'DOCENTE' && parseNullableInt(createDocenteId) == null) {
      setError('DOCENTE requiere Docente ID')
      return
    }
    if (createRol === 'ESTUDIANTE' && createEstudianteId == null) {
      setError('ESTUDIANTE requiere seleccionar un estudiante')
      return
    }

    const documento = createDocumento.trim()
    const clave = createClave

    const docenteId = parseNullableInt(createDocenteId)
    const estudianteId = createEstudianteId
    const links = normalizeLinksForRole(createRol, docenteId, estudianteId)

    const payload: AuthUserCreateRequest = {
      documento,
      clave,
      rol: createRol,
      activo: createActivo,
      docenteId: links.docenteId,
      estudianteId: links.estudianteId,
    }

    setLoading(true)
    try {
      await apiPostJson('/auth/users', payload)
      setCreateDocumento('')
      setCreateClave('')
      setCreateRol('ESTUDIANTE')
      setCreateActivo(true)
      setCreateDocenteId('')
      setCreateEstudianteId(null)
      setCreateEstudianteResetKey((v) => v + 1)
      setToast({ kind: 'success', message: 'Usuario creado' })
      await refresh()
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Error'
      setError(message)
      setToast({ kind: 'error', message })
      setLoading(false)
    }
  }

  async function onUpdate(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setError(null)

    if (editRol === 'DOCENTE' && parseNullableInt(editDocenteId) == null) {
      setError('DOCENTE requiere Docente ID')
      return
    }
    if (editRol === 'ESTUDIANTE' && editEstudianteId == null) {
      setError('ESTUDIANTE requiere seleccionar un estudiante')
      return
    }

    const documento = editDocumento.trim()
    const clave = editClave.trim() === '' ? undefined : editClave
    const docenteId = parseNullableInt(editDocenteId)
    const estudianteId = editEstudianteId
    const links = normalizeLinksForRole(editRol, docenteId, estudianteId)

    const payload: AuthUserUpdateRequest = {
      documento,
      rol: editRol,
      activo: editActivo,
      ...(clave === undefined ? {} : { clave }),
      docenteId: links.docenteId,
      estudianteId: links.estudianteId,
    }

    setLoading(true)
    try {
      await apiPutJson<AuthUserResponse>(`/auth/users/${selected.id}`, payload)
      await refresh()
      setSelectedId(selected.id)
      setToast({ kind: 'success', message: 'Usuario actualizado' })
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Error'
      setError(message)
      setToast({ kind: 'error', message })
      setLoading(false)
    }
  }

  async function onDelete(user: AuthUserResponse) {
    const ok = window.confirm(`Eliminar usuario ${user.documento}?`)
    if (!ok) return

    setLoading(true)
    setError(null)
    try {
      await apiDelete(`/auth/users/${user.id}`)
      if (selectedId === user.id) setSelectedId(null)
      await refresh()
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Error'
      setError(message)
      setLoading(false)
    }
  }

  return (
    <div className="usersContainer">
      <div
        className="stack"
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: 12,
          rowGap: 8,
          alignItems: 'start',
        }}
      >
        <h2 style={{ margin: 0, textAlign: 'left', paddingTop: 6, gridColumn: 1 }}>Usuarios</h2>

      <form onSubmit={onCreate} className="card" style={{ gridColumn: 2 }}>
        <h3 style={{ margin: 0 }}>Crear</h3>
        <div className="row">
          <label style={{ flex: '1 1 180px', maxWidth: 260 }}>
            Documento
            <input value={createDocumento} onChange={(e) => setCreateDocumento(e.target.value)} required />
          </label>
          <label style={{ flex: '1 1 180px', maxWidth: 260 }}>
            Clave
            <input value={createClave} onChange={(e) => setCreateClave(e.target.value)} type="password" required />
          </label>
          <label>
            Rol
            <select value={createRol} onChange={(e) => setCreateRol(e.target.value as UserRole)}>
              <option value="ADMIN">ADMIN</option>
              <option value="DOCENTE">DOCENTE</option>
              <option value="ESTUDIANTE">ESTUDIANTE</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 22 }}>
            <input type="checkbox" checked={createActivo} onChange={(e) => setCreateActivo(e.target.checked)} />
            Activo
          </label>
        </div>
        <div className="row">
          <label style={{ flex: '1 1 180px', maxWidth: 260 }}>
            Docente ID
            <input
              value={createDocenteId}
              onChange={(e) => setCreateDocenteId(e.target.value)}
              inputMode="numeric"
              placeholder={createRol === 'DOCENTE' ? 'Requerido' : '—'}
              disabled={createRol !== 'DOCENTE'}
            />
          </label>
          <EstudianteCombobox
            disabled={createRol !== 'ESTUDIANTE'}
            required={createRol === 'ESTUDIANTE'}
            estudiantes={estudiantes}
            selectedId={createEstudianteId}
            onSelectedId={setCreateEstudianteId}
            resetKey={createEstudianteResetKey}
          />
          <div />
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
            <button type="submit" className="btnCompact" disabled={loading}>
              Crear
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <div className="error" style={{ gridColumn: 2 }}>
          {error}
        </div>
      ) : (
        <div style={{ gridColumn: 2 }} />
      )}

      <div className="card" style={{ gridColumn: 2 }}>
        <h3 style={{ margin: 0 }}>Lista</h3>
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div className="field" style={{ minWidth: 240 }}>
            <label>Documento</label>
            <input
              value={documentFilter}
              onChange={(e) => setDocumentFilter(e.target.value)}
              placeholder="Filtrar…"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="muted">
              {loading
                ? 'Cargando…'
                : documentFilter.trim()
                  ? `${filteredUsers.length}/${users.length} usuario(s)`
                  : `${users.length} usuario(s)`}
            </div>
            <button type="button" className="btnCompact" onClick={refresh} disabled={loading}>
              Recargar
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>ID</th>
                <th style={{ textAlign: 'left' }}>Documento</th>
                <th style={{ textAlign: 'left' }}>Rol</th>
                <th style={{ textAlign: 'left' }}>Activo</th>
                <th style={{ textAlign: 'left' }}>Docente</th>
                <th style={{ textAlign: 'left' }}>Estudiante</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                  <td>{u.id}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelectedId(u.id)}
                      style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                      title="Editar"
                    >
                      {u.documento}
                    </button>
                  </td>
                  <td>{u.rol}</td>
                  <td>{u.activo ? 'Sí' : 'No'}</td>
                  <td>{u.docenteId ?? '—'}</td>
                  <td>{u.estudianteId ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button type="button" className="btnCompact" onClick={() => setSelectedId(u.id)} disabled={loading}>
                        Editar
                      </button>
                      <button type="button" className="btnCompact" onClick={() => onDelete(u)} disabled={loading}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {estudiantesError ? (
        <div className="muted" style={{ fontSize: 12 }}>
          No se pudo cargar estudiantes: {estudiantesError}
        </div>
      ) : null}

      {selected ? (
        <form onSubmit={onUpdate} className="card" style={{ gridColumn: 2 }}>
          <h3 style={{ margin: 0 }}>Editar #{selected.id}</h3>
          <div className="row">
            <label style={{ flex: '1 1 180px', maxWidth: 260 }}>
              Documento
              <input value={editDocumento} onChange={(e) => setEditDocumento(e.target.value)} required />
            </label>
            <label style={{ flex: '1 1 180px', maxWidth: 260 }}>
              Clave (opcional)
              <input
                value={editClave}
                onChange={(e) => setEditClave(e.target.value)}
                type="password"
                placeholder="Dejar vacío para no cambiar"
              />
            </label>
            <label>
              Rol
              <select value={editRol} onChange={(e) => setEditRol(e.target.value as UserRole)}>
                <option value="ADMIN">ADMIN</option>
                <option value="DOCENTE">DOCENTE</option>
                <option value="ESTUDIANTE">ESTUDIANTE</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 22 }}>
              <input type="checkbox" checked={editActivo} onChange={(e) => setEditActivo(e.target.checked)} />
              Activo
            </label>
          </div>
          <div className="row">
            <label style={{ flex: '1 1 180px', maxWidth: 260 }}>
              Docente ID
              <input
                value={editDocenteId}
                onChange={(e) => setEditDocenteId(e.target.value)}
                inputMode="numeric"
                placeholder={editRol === 'DOCENTE' ? 'Requerido' : '—'}
                disabled={editRol !== 'DOCENTE'}
              />
            </label>
            <EstudianteCombobox
              disabled={editRol !== 'ESTUDIANTE'}
              required={editRol === 'ESTUDIANTE'}
              estudiantes={estudiantes}
              selectedId={editEstudianteId}
              onSelectedId={setEditEstudianteId}
            />
            <div />
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 8 }}>
              <button type="button" className="btnCompact" onClick={() => setSelectedId(null)} disabled={loading}>
                Cerrar
              </button>
              <button type="submit" className="btnCompact" disabled={loading}>
                Guardar
              </button>
            </div>
          </div>
        </form>
      ) : null}

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
                <div style={{ fontWeight: 800, marginBottom: 2 }}>{toast.kind === 'success' ? 'Éxito' : 'Error'}</div>
                <div style={{ fontSize: 13, color: 'var(--wg-text)' }}>{toast.message}</div>
              </div>
              <button
                type="button"
                className="btnSecondary headerBtn"
                onClick={() => setToast(null)}
                disabled={loading}
                title="Cerrar"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  )
}
