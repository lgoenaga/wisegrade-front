import { type FormEvent, useEffect, useMemo, useState } from 'react'

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

export default function UsersView() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<AuthUserResponse[]>([])

  const [createDocumento, setCreateDocumento] = useState('')
  const [createClave, setCreateClave] = useState('')
  const [createRol, setCreateRol] = useState<UserRole>('ESTUDIANTE')
  const [createActivo, setCreateActivo] = useState(true)
  const [createDocenteId, setCreateDocenteId] = useState<string>('')
  const [createEstudianteId, setCreateEstudianteId] = useState<string>('')

  const [selectedId, setSelectedId] = useState<number | null>(null)

  const selected = useMemo(() => users.find((u) => u.id === selectedId) ?? null, [users, selectedId])

  const [editDocumento, setEditDocumento] = useState('')
  const [editClave, setEditClave] = useState('')
  const [editRol, setEditRol] = useState<UserRole>('ESTUDIANTE')
  const [editActivo, setEditActivo] = useState(true)
  const [editDocenteId, setEditDocenteId] = useState<string>('')
  const [editEstudianteId, setEditEstudianteId] = useState<string>('')

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
    if (!selected) return
    setEditDocumento(selected.documento)
    setEditRol(selected.rol)
    setEditActivo(selected.activo)
    setEditClave('')
    setEditDocenteId(selected.docenteId == null ? '' : String(selected.docenteId))
    setEditEstudianteId(selected.estudianteId == null ? '' : String(selected.estudianteId))
  }, [selected])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const documento = createDocumento.trim()
    const clave = createClave

    const docenteId = parseNullableInt(createDocenteId)
    const estudianteId = parseNullableInt(createEstudianteId)
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
      setCreateEstudianteId('')
      await refresh()
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Error'
      setError(message)
      setLoading(false)
    }
  }

  async function onUpdate(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setError(null)

    const documento = editDocumento.trim()
    const clave = editClave.trim() === '' ? undefined : editClave
    const docenteId = parseNullableInt(editDocenteId)
    const estudianteId = parseNullableInt(editEstudianteId)
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
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : 'Error'
      setError(message)
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
    <div className="stack">
      <h2>Usuarios</h2>

      {error ? <div className="error">{error}</div> : null}

      <form onSubmit={onCreate} className="card">
        <h3>Crear</h3>
        <div className="row">
          <label>
            Documento
            <input value={createDocumento} onChange={(e) => setCreateDocumento(e.target.value)} required />
          </label>
          <label>
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
          <label>
            Docente ID
            <input
              value={createDocenteId}
              onChange={(e) => setCreateDocenteId(e.target.value)}
              inputMode="numeric"
              placeholder={createRol === 'DOCENTE' ? 'Requerido' : '—'}
              disabled={createRol !== 'DOCENTE'}
            />
          </label>
          <label>
            Estudiante ID
            <input
              value={createEstudianteId}
              onChange={(e) => setCreateEstudianteId(e.target.value)}
              inputMode="numeric"
              placeholder={createRol === 'ESTUDIANTE' ? 'Requerido' : '—'}
              disabled={createRol !== 'ESTUDIANTE'}
            />
          </label>
          <div />
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
            <button type="submit" disabled={loading}>
              Crear
            </button>
          </div>
        </div>
      </form>

      <div className="card">
        <h3>Lista</h3>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <div>{loading ? 'Cargando…' : `${users.length} usuario(s)`}</div>
          <button type="button" onClick={refresh} disabled={loading}>
            Recargar
          </button>
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
                <th style={{ textAlign: 'left' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
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
                  <td>
                    <button type="button" onClick={() => setSelectedId(u.id)} disabled={loading}>
                      Editar
                    </button>{' '}
                    <button type="button" onClick={() => onDelete(u)} disabled={loading}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <form onSubmit={onUpdate} className="card">
          <h3>Editar #{selected.id}</h3>
          <div className="row">
            <label>
              Documento
              <input value={editDocumento} onChange={(e) => setEditDocumento(e.target.value)} required />
            </label>
            <label>
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
            <label>
              Docente ID
              <input
                value={editDocenteId}
                onChange={(e) => setEditDocenteId(e.target.value)}
                inputMode="numeric"
                placeholder={editRol === 'DOCENTE' ? 'Requerido' : '—'}
                disabled={editRol !== 'DOCENTE'}
              />
            </label>
            <label>
              Estudiante ID
              <input
                value={editEstudianteId}
                onChange={(e) => setEditEstudianteId(e.target.value)}
                inputMode="numeric"
                placeholder={editRol === 'ESTUDIANTE' ? 'Requerido' : '—'}
                disabled={editRol !== 'ESTUDIANTE'}
              />
            </label>
            <div />
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setSelectedId(null)} disabled={loading}>
                Cerrar
              </button>
              <button type="submit" disabled={loading}>
                Guardar
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  )
}
