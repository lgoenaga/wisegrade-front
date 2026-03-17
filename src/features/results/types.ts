export type EstudianteResumenResponse = {
  id: number
  nombres: string
  apellidos: string
  documento: string
}

export type ResultadoIntentoResponse = {
  correctas: number
  total: number
  notaSobre5: number
}

export type IntentoEstado = 'IN_PROGRESS' | 'BLOCKED' | 'SUBMITTED'

export type ExamenResultadoFilaResponse = {
  intentoId: number
  estado: IntentoEstado
  estudiante: EstudianteResumenResponse
  startedAt: string
  deadlineAt: string | null
  blockedAt: string | null
  reopenCount: number | null
  extraMinutesTotal: number | null
  submittedAt: string | null
  resultado: ResultadoIntentoResponse | null
}

export type ExamenResultadosResponse = {
  examenId: number
  periodoId: number
  materiaId: number
  momentoId: number
  docenteResponsableId: number
  beneficio: boolean
  filas: ExamenResultadoFilaResponse[]
}
