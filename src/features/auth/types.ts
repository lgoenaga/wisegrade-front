export type AuthPersonaResponse = {
  id: number
  documento: string
  nombres: string
  apellidos: string
}

export type UserRole = 'ADMIN' | 'DOCENTE' | 'ESTUDIANTE'

export type AuthMeResponse = {
  documento: string
  rol: UserRole
  estudiante: AuthPersonaResponse | null
  docente: AuthPersonaResponse | null
}

export type AuthLoginRequest = {
  documento: string
  clave: string
}
