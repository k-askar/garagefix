# Frontend — React (CRA) build served by Nginx
# Multi-stage: build with Node, serve static with Nginx.

# --- Stage 1: build ---
FROM node:20-alpine AS build

WORKDIR /app

# REACT_APP_BACKEND_URL is baked in at build time by CRA.
# Pass it via `--build-arg REACT_APP_BACKEND_URL=https://api.example.com`.
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# --- Stage 2: serve ---
FROM nginx:1.27-alpine

# SPA fallback + gzip
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
