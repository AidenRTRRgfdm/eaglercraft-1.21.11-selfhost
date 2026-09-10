FROM node:24-bookworm-slim AS node

FROM eclipse-temurin:25-jre-noble
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 libgcc-s1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 bridge \
    && useradd --uid 10001 --gid bridge --create-home bridge
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --chown=bridge:bridge Server.js package.json ./
COPY --chown=bridge:bridge proxy/ ./proxy/
ENV JAVA_BIN=/opt/java/openjdk/bin/java \
    BACKEND_HOST=host.docker.internal \
    BACKEND_PORT=25566 \
    PROXY_MEMORY_MB=512
USER bridge
VOLUME ["/app/proxy"]
EXPOSE 25565/tcp
STOPSIGNAL SIGTERM
CMD ["node", "Server.js"]
