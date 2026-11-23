FROM grafana/k6:2.4.0 AS workload

COPY --chmod=644 *.js run.sh /scripts/
USER root
RUN chmod 755 /scripts
USER 12345

FROM node:22-alpine AS runner
COPY --from=workload /usr/bin/k6 /usr/bin/k6
COPY --from=workload /scripts /scripts
WORKDIR /scripts/runner
COPY runner/ ./
USER node
CMD ["node", "server.mjs"]

FROM workload AS cli
