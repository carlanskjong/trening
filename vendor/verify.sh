#!/bin/sh
# Re-download the vendored packages from npm, check them against the integrity
# hash npm publishes, and confirm the files in this folder are unchanged copies.
# Usage: ./verify.sh            (check only)
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0

check() {  # package version expected-integrity
  url=$(curl -fsS "https://registry.npmjs.org/$1/$2" | python3 -c "import json,sys; print(json.load(sys.stdin)['dist']['tarball'])")
  curl -fsS -o "$tmp/pkg.tgz" "$url"
  got="sha512-$(openssl dgst -sha512 -binary "$tmp/pkg.tgz" | base64 | tr -d '\n')"
  if [ "$got" = "$3" ]; then echo "ok   $1@$2 tarball matches npm's published hash"
  else echo "FAIL $1@$2 tarball hash differs"; fail=1; fi
  rm -rf "$tmp/package"; tar xzf "$tmp/pkg.tgz" -C "$tmp"
}

same() {  # file-in-package file-here
  if cmp -s "$tmp/package/$1" "$2"; then echo "ok   $2"; else echo "FAIL $2 differs from $1"; fail=1; fi
}

check maplibre-gl 6.11.1 'sha512-PaWLwfxWs6EddrPEsncrnPAyHNN0vm7KpQtoPWN1AQimJ7qwY/7GrwBeI+cB+YlSrw5sCyVKc2ZAbTwJ4MHUdA=='
for f in maplibre-gl.mjs maplibre-gl-shared.mjs maplibre-gl-worker.mjs maplibre-gl.css; do
  same "dist/$f" "maplibre-gl-6.11.1/$f"
done
same LICENSE.txt maplibre-gl-6.11.1/LICENSE.txt

check @fontsource/barlow-semi-condensed 5.3.0 'sha512-EdpQ1GlLMofGqDsQhEw+g6DonNKmzt21p8y/oNbTl4BFzEkqYkFyE2fj25YGxmZBL/LZZGAxe74FlvEWcgc31w=='
for w in 500 600 700; do
  same "files/barlow-semi-condensed-latin-$w-normal.woff2" "fonts/barlow-semi-condensed-$w.woff2"
done
same LICENSE fonts/OFL.txt

exit $fail
