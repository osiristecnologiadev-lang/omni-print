# postgres:16-alpine already ships pg_dump matching this project's
# production Postgres major version (see api/docker-compose.yml's
# timescale/timescaledb:latest-pg16) - bash + rclone + curl (for the
# failure-alert webhook call) are the only things added on top.
FROM postgres:16-alpine

RUN apk add --no-cache bash rclone curl

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
