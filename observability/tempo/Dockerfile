FROM grafana/tempo:2.6.0

USER root
COPY --chmod=644 tempo.yml /etc/tempo/tempo.yml
RUN chmod 755 /etc/tempo && chmod 644 /etc/tempo/tempo.yml
USER 10001
