FROM grafana/grafana-oss:latest

COPY provisioning /etc/grafana/provisioning
COPY dashboards /etc/grafana/dashboards
USER root
RUN chmod -R a+rX /etc/grafana/provisioning /etc/grafana/dashboards
USER grafana
