# Build context: repository root.  docker build -f docker/crank-worker.Dockerfile .
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /app
COPY services/crank-worker/package.json services/crank-worker/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY services/crank-worker/tsconfig.json ./
COPY services/crank-worker/src ./src
RUN npm run build && npm prune --omit=dev \
    && find dist -name '*.map' -delete

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
USER 65532:65532
CMD ["dist/main.js"]
