# postgres:16-alpine already ships pg_dump matching this project's
# production Postgres major version (see api/docker-compose.yml's
# timescale/timescaledb:latest-pg16) - bash + rclone are the only two
# things added on top.
FROM postgres:16-alpine

RUN apk add --no-cache bash rclone

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
