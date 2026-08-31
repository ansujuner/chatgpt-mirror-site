# syntax=docker/dockerfile:1

# Build the browser bundle separately so the runtime image contains no source
# tree or frontend development dependencies.  Empty VITE values are deliberate:
# the production bundle must use the same-origin /api bridge, never mock mode.
FROM node:24.20-bookworm-slim AS frontend-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
RUN VITE_CHAT_API_MODE= VITE_CHAT_API_URL= VITE_CHAT_API_TOKEN= \
    VITE_HOSTED_SESSION_ONLY=true npm run build


# Reuse the official statically linked Caddy binary for the single public
# listener. Caddy serves dist/ and forwards /api/* to the loopback-only bridge.
FROM caddy:2.11.4-alpine AS caddy-bin


# The backend invokes Node for the Turnstile/PoW VM at runtime.  Starting from
# the Node image and installing Debian's Python 3.11 keeps both runtimes in the
# final image without copying an incomplete Node installation by hand.
FROM node:24.20-bookworm-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    NODE_ENV=production \
    XDG_CONFIG_HOME=/tmp/caddy/config \
    XDG_DATA_HOME=/tmp/caddy/data

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        python3 \
        python3-venv \
        tini \
    && python3 -m venv "$VIRTUAL_ENV" \
    && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir --upgrade pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

RUN groupadd --system app \
    && useradd --system --gid app --home-dir /app app \
    && install -d --owner app --group app /app/.runtime /tmp/caddy/config /tmp/caddy/data

COPY --chown=app:app server ./server
COPY --chown=app:app --from=frontend-build /app/dist ./dist
COPY --from=caddy-bin /usr/bin/caddy /usr/local/bin/caddy
COPY --chown=app:app deploy/container-entrypoint.sh /usr/local/bin/container-entrypoint
RUN chmod 0755 /usr/local/bin/caddy /usr/local/bin/container-entrypoint

USER app

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/container-entrypoint"]
