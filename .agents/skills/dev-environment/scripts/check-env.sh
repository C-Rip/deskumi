#!/usr/bin/env bash
# Verifica el entorno de desarrollo de Deskumi (Linux).
# Sale con código 1 si falta algo obligatorio.
set -uo pipefail

ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✘\033[0m %s\n' "$*"; missing=1; }
missing=0

distro="unknown"
[[ -r /etc/os-release ]] && . /etc/os-release && distro="${ID:-unknown}"
case "$distro" in
  fedora|nobara|rhel|centos) family="fedora" ;;
  debian|ubuntu|linuxmint|pop) family="debian" ;;
  *) family="other" ;;
esac

echo "== Sistema =="
ok "Distro: ${PRETTY_NAME:-$distro}"
ok "Sesión: ${XDG_SESSION_TYPE:-?} · Escritorio: ${XDG_CURRENT_DESKTOP:-?}"
if command -v lspci >/dev/null; then
  gpu="$(lspci | grep -iE 'vga|3d' | sed 's/.*: //' | head -n1)"
  ok "GPU: ${gpu:-?}"
  [[ "$gpu" == *NVIDIA* ]] && warn "NVIDIA detectada: revisa skill linux-overlay-troubleshooting"
fi

echo "== Toolchains =="
if command -v node >/dev/null; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  (( major >= 20 )) && ok "node $(node -v)" || bad "node $(node -v) (< 20)"
else bad "node no instalado"; fi
command -v npm   >/dev/null && ok "npm $(npm -v)"           || bad "npm no instalado"
command -v cargo >/dev/null && ok "$(cargo --version)"      || bad "cargo no instalado (https://rustup.rs)"
command -v rustc >/dev/null && ok "$(rustc --version)"      || bad "rustc no instalado"
command -v git   >/dev/null && ok "$(git --version)"        || bad "git no instalado"

echo "== Librerías de sistema (pkg-config) =="
command -v pkg-config >/dev/null || bad "pkg-config no instalado"
check_pc() {
  local mod="$1" pkg_f="$2" pkg_d="$3"
  if pkg-config --exists "$mod" 2>/dev/null; then
    ok "$mod $(pkg-config --modversion "$mod")"
  else
    case "$family" in
      fedora) bad "$mod  →  sudo dnf install $pkg_f" ;;
      debian) bad "$mod  →  sudo apt install $pkg_d" ;;
      *)      bad "$mod (instala el paquete de desarrollo equivalente)" ;;
    esac
  fi
}
check_pc webkit2gtk-4.1 webkit2gtk4.1-devel libwebkit2gtk-4.1-dev
check_pc gtk+-3.0       gtk3-devel          libgtk-3-dev
check_pc openssl        openssl-devel       libssl-dev
check_pc librsvg-2.0    librsvg2-devel      librsvg2-dev
if pkg-config --exists ayatana-appindicator3-0.1 2>/dev/null || pkg-config --exists appindicator3-0.1 2>/dev/null; then
  ok "appindicator (tray)"
else
  warn "appindicator no encontrado (necesario para tray en F4): fedora → libappindicator-gtk3-devel · debian → libayatana-appindicator3-dev"
fi

echo "== Repo =="
hooks="$(git config --get core.hooksPath || true)"
[[ "$hooks" == ".githooks" ]] && ok "git hooks activos" || warn "git hooks inactivos → git config core.hooksPath .githooks"

echo
if (( missing )); then
  echo "Faltan dependencias obligatorias. (Agentes: muestren los comandos al usuario; no ejecuten sudo.)"
  exit 1
fi
echo "Entorno listo ✔"
