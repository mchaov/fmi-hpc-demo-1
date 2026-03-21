FROM grafana/k6:latest

COPY --chmod=644 . /scripts
USER root
RUN chmod 755 /scripts && chmod -R a+rX /scripts
USER 12345
