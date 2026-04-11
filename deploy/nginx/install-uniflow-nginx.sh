#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_SRC="${SCRIPT_DIR}/uniflow-single-port.conf"
CONF_DST="/etc/nginx/sites-available/uniflow-single-port.conf"
CONF_LINK="/etc/nginx/sites-enabled/uniflow-single-port.conf"
DEFAULT_LINK="/etc/nginx/sites-enabled/default"

if [[ ! -f "${CONF_SRC}" ]]; then
  echo "Missing source config: ${CONF_SRC}" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx
fi

install -D -m 0644 "${CONF_SRC}" "${CONF_DST}"
ln -sfn "${CONF_DST}" "${CONF_LINK}"

if [[ -L "${DEFAULT_LINK}" || -f "${DEFAULT_LINK}" ]]; then
  rm -f "${DEFAULT_LINK}"
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "Nginx site enabled: ${CONF_DST}"
echo "Public entrypoint: http://202.200.206.250"
