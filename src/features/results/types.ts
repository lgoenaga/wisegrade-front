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

export type ExamenResultadoFilaResponse = {
  intentoId: number
  estudiante: EstudianteResumenResponse
  startedAt: string
  submittedAt: string
  resultado: ResultadoIntentoResponse
}

export type ExamenResultadosResponse = {
  examenId: number
  periodoId: number
  materiaId: number
  momentoId: number
  docenteResponsableId: number
  filas: ExamenResultadoFilaResponse[]
}
