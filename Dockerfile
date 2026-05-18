# ---------- BUILD ----------
FROM node:20-alpine AS build

WORKDIR /app

# Copiar dependencias primero (mejor cache)
COPY package.json package-lock.json ./
RUN npm install

# Copiar el resto del proyecto
COPY . .

# Build de Vite
RUN npm run build

# ---------- SERVE ----------
FROM nginx:1.31.0-alpine

# Limpiar config default (evita errores SPA)
RUN rm -rf /usr/share/nginx/html/*

# Copiar build final
COPY --from=build /app/dist /usr/share/nginx/html

# Puerto interno
EXPOSE 80

# Iniciar nginx
CMD ["nginx", "-g", "daemon off;"]
