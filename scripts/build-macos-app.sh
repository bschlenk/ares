#!/bin/sh
# Run from any directory. Keep the previous app until its replacement is complete.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD=${ARES_NATIVE_BUILD_DIR:-"$ROOT/build_macos/workbench"}
case "$BUILD" in
  /*) ;;
  *) BUILD="$ROOT/$BUILD" ;;
esac
DESTINATION="$ROOT/build_macos/Ares.app"
JOBS=${ARES_BUILD_JOBS:-8}
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'App packaging currently supports macOS Apple Silicon.' >&2
  exit 1
fi
cmake -S "$ROOT" -B "$BUILD" -G 'Unix Makefiles' \
  -UARES_CORES -DARES_BUILD_ELECTRON_UI=ON \
  -DARES_BUILD_OPTIONAL_TARGETS=OFF -DARES_ENABLE_LIBRASHADER=OFF \
  -DENABLE_CCACHE=OFF -DENABLE_IPO=OFF -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build "$BUILD" --target ares-electron-host -j "$JOBS"
if ! npm ls --prefix "$ROOT/electron-ui" --depth=0 >/dev/null 2>&1; then
  npm ci --prefix "$ROOT/electron-ui"
fi
mkdir -p "$ROOT/build_macos"
STAGING=$(mktemp -d "$ROOT/build_macos/.ares-package.XXXXXX")
cleanup() {
  if [ ! -e "$DESTINATION" ] && [ -e "$STAGING/previous.app" ]; then
    mv -- "$STAGING/previous.app" "$DESTINATION"
  fi
  rm -rf -- "$STAGING"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
ARES_HOST="$BUILD/bin/ares-electron-host" npm run package:mac --prefix "$ROOT/electron-ui" -- "$STAGING/Ares.app"
# Both moves stay on the same filesystem. Restore the old app if publication fails.
if [ -e "$DESTINATION" ]; then mv -- "$DESTINATION" "$STAGING/previous.app"; fi
if ! mv -- "$STAGING/Ares.app" "$DESTINATION"; then
  if [ -e "$STAGING/previous.app" ]; then mv -- "$STAGING/previous.app" "$DESTINATION"; fi
  exit 1
fi
printf 'Built %s\nRun: open "%s"\n' "$DESTINATION" "$DESTINATION"
