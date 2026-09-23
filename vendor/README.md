# Vendored third-party files

Everything the dashboard runs is either written in this repo or listed here.
These files are copied **unchanged** from the official npm releases, pinned to
one exact version, and served from this site - never loaded from a CDN at
runtime, so they cannot change underneath the app.

| Package | Version | Licence | npm tarball integrity (as published) |
|---|---|---|---|
| [maplibre-gl](https://www.npmjs.com/package/maplibre-gl) | 6.11.1 | BSD-3-Clause | `sha512-PaWLwfxWs6EddrPEsncrnPAyHNN0vm7KpQtoPWN1AQimJ7qwY/7GrwBeI+cB+YlSrw5sCyVKc2ZAbTwJ4MHUdA==` |
| [@fontsource/barlow-semi-condensed](https://www.npmjs.com/package/@fontsource/barlow-semi-condensed) | 5.3.0 | SIL OFL 1.1 | `sha512-EdpQ1GlLMofGqDsQhEw+g6DonNKmzt21p8y/oNbTl4BFzEkqYkFyE2fj25YGxmZBL/LZZGAxe74FlvEWcgc31w==` |

MapLibre is the open-source fork of Mapbox GL JS, maintained by the MapLibre
organisation. It has no telemetry. Only `dist/maplibre-gl{,-shared,-worker}.mjs`
and `maplibre-gl.css` are used; the fonts are the Latin subset, weights 500-700,
renamed to `barlow-semi-condensed-<weight>.woff2`.

`./verify.sh` downloads both tarballs again, checks them against the hashes
above, and confirms every file here is byte-identical to the one inside.

SHA-256 of each file as committed:

```
56027070a748db90a33c074bf7b9b7f0df66dd38a8a0d3e3a951f79035f9c4a0  ./fonts/OFL.txt
0d7513795eaf8fdab7f340144841bd2d9fac7d9303c03aa6b525a2c908e9b371  ./fonts/barlow-semi-condensed-500.woff2
f158417e9207b5362f9b71a2fe779ce5bb836ad972f38445c3163af39d2c998d  ./fonts/barlow-semi-condensed-600.woff2
fb958c8c20a05552ac8a85d925d96028d52565792650e941a5fe96b6997aa5cb  ./fonts/barlow-semi-condensed-700.woff2
ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2  ./maplibre-gl-6.11.1/LICENSE.txt
43110afea7c453d547855a562558f39e41d7abdc70e6853734bc8967974d716b  ./maplibre-gl-6.11.1/maplibre-gl-shared.mjs
9b59b123156783b3abc6d2d83f1ff02699a87ffd058557bbf22a62123de4dcac  ./maplibre-gl-6.11.1/maplibre-gl-worker.mjs
d8617d8421930e3fc6185365400e788c374c1a5d9fbe87999998c0bc14a202d3  ./maplibre-gl-6.11.1/maplibre-gl.css
ba262b95afed8ee89dbfdb8476f001c6ede2230660eb6edd6f453cb350c11f55  ./maplibre-gl-6.11.1/maplibre-gl.mjs
```

To update: download the new version from npm, copy the same files in, put the new
version and published integrity into `verify.sh` and this table, and run it.
