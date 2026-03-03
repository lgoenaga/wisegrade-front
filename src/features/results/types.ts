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

export type IntentoEstado = 'IN_PROGRESS' | 'SUBMITTED'

export type ExamenResultadoFilaResponse = {
  intentoId: number
  estado: IntentoEstado
  estudiante: EstudianteResumenResponse
  startedAt: string
  submittedAt: string | null
  resultado: ResultadoIntentoResponse | null
}

export type ExamenResultadosResponse = {
  examenId: number
  periodoId: number
  materiaId: number
  momentoId: number
  docenteResponsableId: number
  filas: ExamenResultadoFilaResponse[]
}
