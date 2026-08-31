#!/bin/sh
set -eu

public_port="${PORT:-8000}"
bridge_port="${CHATGPT_BRIDGE_INTERNAL_PORT:-8787}"

validate_port() {
  label="$1"
  value="$2"
  case "$value" in
    ''|*[!0-9]*)
      echo "$label must be an integer between 1 and 65535" >&2
      exit 64
      ;;
  esac
  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    echo "$label must be between 1 and 65535" >&2
    exit 64
  fi
}

validate_port PORT "$public_port"
validate_port CHATGPT_BRIDGE_INTERNAL_PORT "$bridge_port"

# The hosting platform routes public traffic to PORT. Keep the stateful Python
# bridge private and let Caddy be the only public listener. Avoid a collision
# if PORT is explicitly overridden to the usual internal value.
if [ "$bridge_port" = "$public_port" ]; then
  if [ "$public_port" = "8787" ]; then
    bridge_port=8788
  else
    bridge_port=8787
  fi
fi

export CHATGPT_BRIDGE_HOST=127.0.0.1
export CHATGPT_BRIDGE_PORT="$bridge_port"
export CHATGPT_BRIDGE_TRUSTED_PROXY_IPS="${CHATGPT_BRIDGE_TRUSTED_PROXY_IPS:-127.0.0.1}"

# A hosting edge normally terminates public TLS before forwarding plain HTTP to
# this container. Use a platform-provided canonical URL when one is available;
# otherwise Caddy's trusted Host/X-Forwarded-Proto headers let the bridge derive
# the same-origin HTTPS URL per request.
if [ -z "${CHATGPT_BRIDGE_PUBLIC_ORIGIN:-}" ]; then
  if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
    CHATGPT_BRIDGE_PUBLIC_ORIGIN="$RENDER_EXTERNAL_URL"
  elif [ -n "${RENDER_EXTERNAL_HOSTNAME:-}" ]; then
    CHATGPT_BRIDGE_PUBLIC_ORIGIN="https://${RENDER_EXTERNAL_HOSTNAME}"
  fi
  export CHATGPT_BRIDGE_PUBLIC_ORIGIN
fi

if [ -z "${CHATGPT_BRIDGE_ALLOWED_ORIGINS:-}" ] && [ -n "${CHATGPT_BRIDGE_PUBLIC_ORIGIN:-}" ]; then
  export CHATGPT_BRIDGE_ALLOWED_ORIGINS="$CHATGPT_BRIDGE_PUBLIC_ORIGIN"
fi

if [ -z "${CHATGPT_BRIDGE_ALLOWED_HOSTS:-}" ] && [ -n "${RENDER_EXTERNAL_HOSTNAME:-}" ]; then
  export CHATGPT_BRIDGE_ALLOWED_HOSTS="${RENDER_EXTERNAL_HOSTNAME},127.0.0.1,localhost"
fi

caddy_config="$(mktemp /tmp/container-caddy.XXXXXX)"
cat >"$caddy_config" <<EOF
{
	admin off
	auto_https off
	persist_config off
}

:${public_port} {
	encode zstd gzip
	header {
		-Server
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "geolocation=(), payment=(), usb=()"
	}

	@api path /api /api/*
	handle @api {
		header Cache-Control "no-store"
		reverse_proxy 127.0.0.1:${bridge_port} {
			# The public edge terminates TLS before forwarding HTTP to this
			# container. Preserve the browser-visible origin for FastAPI's
			# same-origin write checks and Secure cookie calculation.
			header_up Host {host}
			header_up X-Forwarded-Host {host}
			header_up X-Forwarded-Proto https
			flush_interval -1
		}
	}

	handle {
		root * /app/dist
		try_files {path} /index.html
		file_server
	}
}
EOF

backend_pid=''
proxy_pid=''

stop_children() {
  trap - TERM INT
  if [ -n "$proxy_pid" ]; then
    kill -TERM "$proxy_pid" 2>/dev/null || true
  fi
  if [ -n "$backend_pid" ]; then
    kill -TERM "$backend_pid" 2>/dev/null || true
  fi
  if [ -n "$proxy_pid" ]; then
    wait "$proxy_pid" 2>/dev/null || true
  fi
  if [ -n "$backend_pid" ]; then
    wait "$backend_pid" 2>/dev/null || true
  fi
  rm -f "$caddy_config"
}

on_signal() {
  stop_children
  exit 0
}

trap on_signal TERM INT
trap 'rm -f "$caddy_config"' 0

python -m server &
backend_pid=$!

caddy run --config "$caddy_config" --adapter caddyfile &
proxy_pid=$!

# POSIX sh has no portable `wait -n`. Poll both children and terminate the
# survivor if either process exits, so the hosting platform restarts an
# unhealthy service instead of leaving a static-only or API-only container.
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$backend_pid" 2>/dev/null; then
  if wait "$backend_pid"; then
    exit_status=1
  else
    exit_status=$?
  fi
  echo "Python bridge exited; stopping Caddy" >&2
else
  if wait "$proxy_pid"; then
    exit_status=1
  else
    exit_status=$?
  fi
  echo "Caddy exited; stopping Python bridge" >&2
fi

stop_children
trap - 0
exit "$exit_status"
