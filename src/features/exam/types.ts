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
