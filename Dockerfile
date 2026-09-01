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


# Hostless uses a rootless image unpacker which cannot restore the
# security.capability xattr carried by /usr/bin/caddy in the official image.
# Fetch the same upstream release archive instead; it contains the static
# binary without that container-layer xattr. Pin its digest so this remains a
# reproducible supply-chain boundary while retaining Caddy as the one public
# listener for static files and the loopback-only /api bridge.
FROM node:24.20-bookworm-slim AS caddy-bin

ARG CADDY_VERSION=2.11.4
ARG TARGETARCH

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        curl \
        gzip \
        tar \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "${target_arch}" in \
        amd64) \
            caddy_sha512='8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9' \
            ;; \
        arm64) \
            caddy_sha512='d5a7c423853c24a799765e0e8210d5c7c22a8f56ed37a3cae2fb9f58be138853c02b4efd6b59d576e6d8c7c0d30b9c1592deeaa6a536ff69bcca23b8c1ea709c' \
            ;; \
        *) \
            echo "Unsupported Caddy target architecture: ${target_arch}" >&2; \
            exit 1 \
            ;; \
    esac; \
    archive="caddy_${CADDY_VERSION}_linux_${target_arch}.tar.gz"; \
    curl --fail --location --show-error --silent \
        "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/${archive}" \
        --output "/tmp/${archive}"; \
    echo "${caddy_sha512}  /tmp/${archive}" | sha512sum --check --strict -; \
    mkdir /out; \
    tar --extract --gzip --file "/tmp/${archive}" --directory /out caddy; \
    chmod 0755 /out/caddy


# The backend invokes Node for the Turnstile/PoW VM at runtime.  Starting from
# the Node image and installing Debian's Python 3.11 keeps both runtimes in the
# final image without copying an incomplete Node installation by hand.
FROM node:24.20-bookworm-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    NODE_ENV=production \
    CHATGPT_AUTH_VERIFY_TLS=true \
    CHATGPT_BRIDGE_VERIFY_TLS=true \
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
COPY --from=caddy-bin /out/caddy /usr/local/bin/caddy
COPY --chown=app:app deploy/container-entrypoint.sh /usr/local/bin/container-entrypoint
RUN chmod 0755 /usr/local/bin/caddy /usr/local/bin/container-entrypoint

USER app

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/container-entrypoint"]
