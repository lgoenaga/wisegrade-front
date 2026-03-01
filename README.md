## WiseGrade (Frontend)

Frontend en **React + Vite (TypeScript)** para consumir el backend de WiseGrade (Spring Boot).

Su función principal es que un estudiante pueda:

- Iniciar un intento de examen.
- Responder preguntas (guardando progreso local).
- Enviar el intento al backend con tolerancia a fallos de red.

Además soporta autenticación por **sesión** (login) y UI por rol (estudiante/docente/admin).

Documentación de snapshot del estado actual: ver `../Documents/frontend-summary.md`.

---

## Requisitos

- Node.js + npm
- Backend corriendo (por defecto en `http://localhost:8080`)

---

## Configuración

Crear un `.env.local` (o exportar variables) basado en `.env.example`:

```bash
cp .env.example .env.local
```

Variables:

- `VITE_API_BASE_URL` (default: `http://localhost:8080`)
- `VITE_EXAM_DURATION_MINUTES` (default: `30`, solo countdown UI)

---

## Ejecutar en desarrollo

```bash
npm install
npm run dev
```

Otros comandos:

- `npm run build`
- `npm run preview`
- `npm run lint`

---

## Flujo local típico (end-to-end)

1. Levanta MySQL y el backend.
2. En backend, ejecuta el seed demo (imprime IDs):

```bash
cd ../backend
./scripts/seed-demo-exam.sh
```

3. Inicia el frontend (`npm run dev`).
4. Inicia sesión:

- Admin: puede iniciar intento o ver resultados.
- Docente: solo ve Resultados.
- Estudiante: solo presenta examen (estudiante fijo por sesión).

5. Si estás como admin, en la pantalla inicial pega los IDs (periodo/materia/momento/docente/estudiante) e inicia el intento.

---

## Endpoints que consume

- Auth (sesión):
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`

- Catálogos:
  - `GET /api/periodos`
  - `GET /api/materias`
  - `GET /api/momentos`
  - `GET /api/docentes`
- Intentos:
  - `POST /api/intentos/iniciar`
  - `POST /api/intentos/enviar`
  - `GET /api/intentos/{intentoId}`

Incluye una pantalla de **Resultados** para consultar intentos SUBMITTED por configuración:

- `GET /api/examenes/resultados?periodoId=...&materiaId=...&momentoId=...&docenteResponsableId=...`

---

## Persistencia local (LocalStorage)

Claves usadas:

- `wisegrade:lastAttemptId`
- `wisegrade:attempt:<intentoId>` (snapshot del intento + respuestas + flags)

Para re-probar desde cero: borra claves `wisegrade:*` en el navegador.

---

## Antitrampa (mínimo)

- Cambio de pestaña/ventana, pérdida de foco, salida de fullscreen
- 3 advertencias ⇒ bloqueo de responder
- Al bloquear ⇒ auto-envío del intento
- Tras enviar (`SUBMITTED`) el cronómetro se congela y no se permite presentar nuevamente

---

## Troubleshooting

- **CORS / cookies de sesión**: revisa `APP_CORS_ALLOWED_ORIGINS` en el backend (default `http://localhost:5173`).
- **Login falla**: si documento/clave no coinciden, el backend responde `401` con `"Credenciales inválidas"`.
- **"Examen not found"**: falta cargar banco de preguntas para esa combinación (o falta asociación docente↔materia).
- **Se queda en "pending submit"**: normalmente es backend caído/red inestable; al volver el backend el frontend reintenta cada ~5s.
