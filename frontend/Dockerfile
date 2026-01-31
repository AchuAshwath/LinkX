# Stage 0, "build-stage", based on Node.js, to build and compile the frontend
FROM node:24 AS build-stage

WORKDIR /app

# Install Bun
RUN npm install -g bun@latest

# Copy lockfile first for better layer caching
COPY bun.lock package.json ./

# Install dependencies using Bun
RUN bun install

# Copy source files
COPY ./ /app/

ARG VITE_API_URL=${VITE_API_URL}

# Build with type checking
RUN bun run build


# Stage 1, based on Nginx, to have only the compiled app, ready for production with Nginx
FROM nginx:1

COPY --from=build-stage /app/dist/ /usr/share/nginx/html

COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY ./nginx-backend-not-found.conf /etc/nginx/extra-conf.d/backend-not-found.conf
