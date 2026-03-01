export type RespuestaCorrecta = 'A' | 'B' | 'C' | 'D'

export type PreguntaGeneratedResponse = {
  id: number
  enunciado: string
  opciones: [string, string, string, string] | string[]
}

export type IntentoIniciarResponse = {
  intentoId: number
  examenId: number
  estudianteId: number
  estado: 'IN_PROGRESS' | 'SUBMITTED'
  startedAt: string
  cantidad: number
  preguntas: PreguntaGeneratedResponse[]
}

export type RespuestaGuardadaResponse = {
  preguntaId: number
  respuesta: RespuestaCorrecta
  respondedAt: string | null
}

export type ResultadoIntentoResponse = {
  correctas: number
  total: number
  notaSobre5: number
}

export type CorreccionPreguntaResponse = {
  preguntaId: number
  respuestaEstudiante: RespuestaCorrecta | null
  respuestaCorrecta: RespuestaCorrecta
  esCorrecta: boolean
  explicacion: string | null
}

export type IntentoDetalleResponse = {
  intentoId: number
  examenId: number
  estudianteId: number
  estado: 'IN_PROGRESS' | 'SUBMITTED'
  startedAt: string
  firstSubmitAttemptAt: string | null
  submittedAt: string | null
  cantidad: number
  preguntas: PreguntaGeneratedResponse[]
  respuestas: RespuestaGuardadaResponse[]
  resultado: ResultadoIntentoResponse | null
  correccion: CorreccionPreguntaResponse[]
}

export type IntentoSnapshot = IntentoIniciarResponse | IntentoDetalleResponse

export type IntentoEnviarResponse = {
  intentoId: number
  estado: 'IN_PROGRESS' | 'SUBMITTED'
  firstSubmitAttemptAt: string | null
  submittedAt: string | null
  respuestasGuardadas: number
}

export type IntentoIniciarRequest = {
  periodoId: number
  materiaId: number
  momentoId: number
  docenteResponsableId: number
  estudianteId: number
  cantidad?: number
}

export type IntentoEnviarRequest = {
  intentoId: number
  respuestas: Array<{ preguntaId: number; respuesta: RespuestaCorrecta }>
}
