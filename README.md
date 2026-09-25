# Luffy7 — Monkey D. Luffy Bot MD

Version **1.1.21** — `#google` busca en toda la web también desde servidores (Railway/Northflank): nueva cadena de motores con timeout corto (~7 s cada uno, ~19 s máximo): APIs opcionales (`GOOGLE_CSE_KEY`+`GOOGLE_CSE_CX` o `BRAVE_API_KEY`, van primero si existen) → DuckDuckGo → Seznam → Mwmbl → Marginalia → Bing → Wikipedia. Captcha o página vacía = se salta al siguiente; resultados sin duplicados y la línea *Fuente* muestra el motor que respondió. Sin dependencias nuevas (no hace falta `npm install`).

### Búsqueda web (`#google`) — variables opcionales

Sin configurar nada, `#google` usa buscadores sin API key: DuckDuckGo → Seznam → Mwmbl → Marginalia → Bing → Wikipedia (en servidores DuckDuckGo y Bing suelen pedir captcha; se saltan solos). Si quieres resultados tipo Google/Brave desde el servidor, agrega **una** de estas (van primero cuando existen):

| Variable | Valor |
|---|---|
| `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | API key y el ID del buscador de Google Programmable Search (Custom Search JSON API) |
| `BRAVE_API_KEY` | Token de Brave Search API (https://brave.com/search/api/) |
| `SEARCH_DISABLE` | (opcional) motores a desactivar, separados por coma: `duckduckgo,seznam,mwmbl,marginalia,bing` |

Version **1.1.20** — `#pdf` ahora convierte *páginas web* (artículos, guías) a PDF: extrae el contenido principal con `@mozilla/readability` + `linkedom` y arma el PDF con `pdfkit` (todo JS puro, sirve en Termux): título, fuente, fecha, encabezados, párrafos, listas y bloques de código en monoespaciado; se envía como documento `titulo-slug.pdf` con tope de 90 MB. Las peticiones ahora usan headers de navegador real (Chrome UA, Accept, Accept-Language es-MX, Referer), si HEAD falla usan GET y ante 5xx/403 reintentan con otro User-Agent; si sigue fallando avisa "El sitio bloqueó la descarga o está caído (HTTP xxx)". Se mantiene Drive, PDF directo, aviso de Scribd/Studocu/SlideShare (no se convierten) y el bloqueo de localhost/IPs privadas también en redirecciones. **Requiere `npm install`** al actualizar.

Version **1.1.19** — nuevo en `#pdf` / `#gdrive`: además de Google Drive/Docs acepta *links directos a PDF* (cualquier http/https que entregue un PDF: se detecta por `Content-Type` o por la firma `%PDF`), sigue redirecciones, lo descarga en streaming con tope de 90 MB y lo envía como documento con el nombre de `Content-Disposition` o de la URL (siempre `.pdf`); más de 90 MB → solo nombre, tamaño y link. Si el link es una página web responde que no es un PDF directo y muestra ejemplos. Scribd, Studocu, pdfcoffee, dokumen.pub, fdocuments y similares exigen cuenta/suscripción: el bot solo avisa y sugiere buscar el título con `#google` o pedir un link de Drive/directo (no se descargan). Ejemplo: `#pdf https://sitio.com/archivo.pdf`.

Version **1.1.18** — nuevo `#google` / `#gg` / `#buscar` / `#googlesearch`: búsqueda web sin API key, top 5 resultados (título, resumen corto y link). Fuentes en orden: DuckDuckGo HTML → DuckDuckGo Lite → Bing (filtra resultados irrelevantes) → Wikipedia (es) → Marginalia, cada una con timeout. Ejemplo: `#google algebra de baldor`. Nuevo `#pdf` / `#gdrive` / `#drive` / `#gd` / `#googledrive`: descarga archivos públicos de Google Drive sin API key y los envía como documento con su nombre y tipo reales (PDF como `application/pdf`). Acepta `/file/d/…`, `open?id=`, `uc?id=` y Google Docs/Sheets/Slides (exporta a PDF/XLSX/PPTX); respeta `resourcekey` de archivos viejos `0B…`. Más de 90 MB → solo nombre, tamaño y link. Ejemplo: `#pdf https://drive.google.com/file/d/…/view`.

Version **1.1.17** — fix `#x`: la API VxTwitter daba 403 por el User-Agent tipo navegador; ahora usa `Luffy7-Bot/1.1 (x-downloader)` y el respaldo FxTwitter → VxTwitter vuelve a funcionar.

Version **1.1.16** — nuevo `#x` / `#twitter` / `#xdownloader` (alias `#xdl`, `#tw`): descarga videos, GIFs e imágenes de X/Twitter (API FxTwitter → VxTwitter → yt-dlp si está instalado), mejor calidad que quepa en WhatsApp, >64 MB como documento (hasta 100 MB), si no, envía el link directo.

Version **1.1.15** — Northflank/WhatsApp: `#ytvideo` build **120 HD-long AVC** (H.264 ≤720p, remux `copy`+faststart, tope **20 min**, sin freeze por AV1). Hotfix play2.js. `#ttsearch` con texto plano (no letras fancy Unicode). Guía Northflank: `NORTHFLANK-WHATSAPP.md` en Andrewmisses-olo.

Version **1.1.14** — Railway/Render: pairing por WHATSAPP_NUMBER (logs), Volume /data. Guia: RAILWAY-WHATSAPP.md

Version **1.1.13** — #apk siempre muestra el link; si pesa >90 MB no intenta subir el archivo.

Version **1.1.12** — fix #play: miniatura YouTube ya no tumba el audio.

Version **1.1.11** — descargas HD: #play/#ytvideo sin yt-search (Alyacore), yt-dlp ≤1080, TikTok yt-dlp fallback, IG/FB/SP reforzados.\n\nVersion **1.1.10** — fix #imagen getChat (TypeError .catch).

Version **1.1.9** — search: #ytsearch (API Alyacore, sin 302), #ttsearch #wiki #pin #imagen #apk #ams.

Version **1.1.8** — `#nano` / `#nanobanana` (editar imagen con prompt NanoBanana).

Version **1.1.7** — IA: #ia #gemini #deepseek #grok.

Version **1.1.6** — descargas en alta calidad (YouTube 1080, XVideos/XNXX HD).

Version **1.1.5** — #menu: si el CDN del banner falla (429), manda el menu en texto. Opcional: #setbanner con una foto tuya.

Bot de WhatsApp (Node.js + Baileys) para **BerNardo77-bot/Luffy7**.
Basado en [nene504273/Monkey-D-luffy-Bot-MD](https://github.com/nene504273/Monkey-D-luffy-Bot-MD).

Proyecto independiente; no afiliado a WhatsApp Inc.

## Descargas activadas

| Comando | Alias | Uso |
|--------|--------|-----|
| `/play` | `/mp3`, `/ytmp3` | YouTube audio |
| `/play2` | `/mp4`, `/ytmp4` | YouTube video |
| `/tiktok` | `/tt`, `/tk`, `/tiktokdl` | TikTok |
| `/tiktokmp3` | `/ttaudio` | TikTok audio |
| `/instagram` | `/ig`, `/reel` | Instagram |
| `/facebook` | `/fb` | Facebook |
| `/spotify` | `/sp` | Spotify |
| `/mediafire` | `/mf` | MediaFire |
| `/x` | `/twitter`, `/xdownloader`, `/xdl`, `/tw` | X/Twitter (video/GIF/imagen) |

API in `settings.js` (`global.api`): key por defecto `LUFFY-FIX67`.

## Instalacion Termux (probado)

```bash
pkg update && pkg upgrade -y
pkg install git nodejs ffmpeg imagemagick libvips yarn -y
termux-setup-storage
git clone https://github.com/BerNardo77-bot/Luffy7
cd Luffy7
npm install
```

`package.json` incluye `sharp` y `@img/sharp-wasm32` (stickers en android-arm64).
Si stickers fallan: `npm install sharp sharp-wasm32 (ver v1.1.0)

### Configurar

```bash
nano settings.js
```

- `global.owner`: tu numero (codigo pais + numero, sin +)
- `global.api.key`: `LUFFY-FIX67` o tu key

### Arrancar

```bash
npm start
```

Escanea el QR: WhatsApp → Dispositivos vinculados.

### En el grupo

```text
/nsfw enable
```

## Actualizar sin reinstalar

```bash
cd ~/Luffy7
pkill -9 -f node || true
git fetch origin
git reset --hard origin/main
npm start
```

No borres la carpeta si no quieres volver a escanear el QR.

Ver tambien `TERMUX.md`.

## Licencia

MIT — credito al proyecto original.

---

## Estado guardado (v1.1.0)

Incluye en main:

- package.json: sharp-wasm32 como dependencia opcional (Termux arm64)
- stickerpack.js: carga diferida de sharp
- nsfw/inter.js: reintentos ante cortes de red ECONNRESET
- mejoras de descargas YouTube y XVideos
- API key por defecto LUFFY-FIX67 en settings.js

Telegram hermano: https://github.com/BerNardo77-bot/Luffy7-Telegram

---

## Estado guardado (v1.1.1)

En `main`:

- Fix: `cmds/dl/tiktok.js` ya carga (sintaxis del `catch` rota impedía registrar el comando)
- Aliases TikTok: `#tiktok` `#tt` `#tk` `#tiktokdl`
- Termux: `git fetch && git reset --hard origin/main` luego reiniciar

Confirmado por el usuario: `#tt` funcionó.

## Estado guardado (Termux, v1.1.1)

Guia desde cero en TERMUX.md.
Si node o ffmpeg fallan con cannot locate symbol: instalar libc++ y openssl, cerrar Termux, y reintentar.

## Estado guardado (v1.1.4)

#ytvideo usa yt-dlp con node como runtime de YouTube (build 116).
Confirmado en Termux. No uses curl a raw.githubusercontent (429). Actualiza con git fetch y git checkout origin/main -- cmds/dl/play2.js

## Estado guardado (grupo, v1.1.4)

En el grupo, un admin activa los comandos que vienen apagados:

#nsfw enable
#gacha enable
#rpg enable

No activar antilink ni adminonly: esos bloquean.
Spotify: dejar un espacio. Ejemplo: #sp https://open.spotify.com/track/...
Confirmado por el usuario: los tres enable funcionan.


## #ytvideo (build 120 HD-long AVC)

- Prefiere H.264 ≤720p (evita AV1 que congela VPS chicos).
- Remux rápido con ffmpeg `-c copy` + `faststart` cuando ya es H.264.
- Tope de duración: **20 minutos** (WhatsApp ~64 MB).
- Misma lógica sincronizada desde Andrewmisses-olo / Northflank.
- `#ttsearch`: texto plano, sin Unicode fancy.
