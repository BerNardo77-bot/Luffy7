# Luffy7 — Monkey D. Luffy Bot MD

Version **1.1.44** — `$cum`, `$anal`, `$fuck`, `$bj` y el resto de interacciones NSFW vuelven a mandar un gif si Alyacore responde HTTP 500.

Version **1.1.43** — las interacciones de anime (`$bored`, `$bite`, `$push`, `$draw` y el resto) vuelven a mandar un gif si Alyacore no trae el listado.

Version **1.1.42** — `$img ani` manda la foto oficial del personaje de Grok, no el logo de ANI News.

Version **1.1.41** — `$google` manda hasta 10 resultados, incluye TikTok cuando la API los trae, y manda la miniatura de cada resultado que trae imagen. El número baja YouTube o TikTok, o resume Wikipedia.

Version **1.1.40** — `$ttsearch` junta varias búsquedas, deja hasta 10 y sube primero los títulos que coinciden. Responder con el número descarga ese video (vale 5 min).

Version **1.1.39** — tras `$google`, un número solo (1–5, vale 5 min) baja el video si es YouTube, o manda el resumen de la página si es Wikipedia. Si no es ni video ni Wikipedia, avisa y deja el enlace. La lista más nueva gana.

Version **1.1.38** — `$google` también pone miniatura en playlists y en YouTube Music. La playlist usa la foto que devuelve YouTube. El canal usa su foto. Si no hay, ese resultado queda en texto.

Version **1.1.37** — `$google` usa la miniatura pública de YouTube (`i.ytimg.com`) en videos, Shorts y youtu.be. En un canal usa la foto del canal. El resto sigue con la foto de la página. Si no hay foto, ese resultado va en texto.

Version **1.1.36** — `$google` manda cada resultado en su propio mensaje (hasta 5), con miniatura. Wikipedia usa la foto de la página. El resto usa `og:image` o `twitter:image`. JPEG y PNG se envían tal cual; WEBP y GIF pasan a JPEG con sharp o ffmpeg. Si no hay foto usable, ese resultado va solo en texto.

Version **1.1.35** — `$ttsearch` manda la miniatura. La búsqueda de Alyacore trae `cover` en WEBP (`image/webp`, no JPEG). Si `sharp` no carga (pasa en Termux), esa WEBP se convierte a JPEG con ffmpeg y se envía como imagen. Si la conversión falla, queda una línea en el log y se prueba el siguiente campo (`origin_cover`, `thumbnail`, `video.cover`, …). Solo va en texto si ninguna portada se baja y convierte. El número suelto sigue descargando ese TikTok.

Version **1.1.34** — `$ttsearch` (también `tiktoksearch` / `tts`) manda cada resultado en su propio mensaje (hasta 10; la API a veces devuelve menos). Si hay portada y el buffer es JPEG o PNG, va como imagen; la portada WEBP de TikTok se convierte a JPEG. El pie lleva número, título, autor, duración y enlace. Sin portada usable, ese resultado va solo en texto. Un número suelto descarga ese TikTok con el mismo descargador que `$tiktok`. Se recuerdan la url y el título 5 minutos, para ese chat y ese remitente, también si el mensaje es `fromMe` y aunque el jid cambie entre `@lid` y `@s.whatsapp.net`. La lista más nueva reemplaza la anterior. Si el número no cabe, dice el rango. Si no hay lista de TikTok pendiente, un número suelto no responde. `$ytsearch`, `$xvideos` y `$xnxx` siguen con su propia lista.

Version **1.1.33** — Tras `$ytsearch` (también `search` / `yts`) un número suelto descarga ese resultado con el mismo descargador que `$ytvideo`. Se recuerdan hasta 10 (url y título) durante 5 minutos, para ese chat y ese remitente, también si el mensaje es `fromMe` y aunque el jid cambie entre `@lid` y `@s.whatsapp.net`. Si el número no cabe en la lista, dice el rango. Si no hay lista pendiente, un número suelto no responde (no se roba un 3 cualquiera). Si el video dura más del tope de `$ytvideo` (20 min), lo dice y no lo baja; ese tope no se sube. `$xvideos` / `$xnxx` siguen eligiendo con 1–5.

Version **1.1.32** — Un número del 1 al 5 (aunque el mensaje sea tuyo, en privado o en grupo, jid `@lid` o `@s.whatsapp.net`) descarga ese resultado. `#xvideos` manda el mp4 progresivo *high*; ya no responde solo con el título y la miniatura.

Version **1.1.31** — `#xvideos` y `#xnxx` ya no eligen un resultado al azar. Solo descargan si cada palabra de la búsqueda (se ignoran las de 1 letra, sin importar mayúsculas) está en el título. Si no, listan hasta 5, cada uno en su propio mensaje: miniatura JPEG o PNG de la API (cover/thumb/thumbnail/image/img/poster) con número, título, duración y url; si la miniatura no sirve, ese resultado va solo en texto. Responder con un número del 1 al 5 en los siguientes 5 minutos (la misma persona, en memoria) descarga ese enlace. También vale el comando con una url directa. El texto usa el prefijo que esté en uso (`#` o `$`). `#xvideos` baja el mp4 progresivo *high* y luego *low* (no HLS; el estado dice high) y no manda MPEG-TS crudo. `#xnxx` mantiene su calidad de siempre. El tope de 20 min de `#ytvideo` no cambia.

Version **1.1.30** — `#ytsearch` manda cada resultado (los primeros 5) como un mensaje aparte con su miniatura, título, duración, canal, vistas y enlace. Si la miniatura de uno falla, ese resultado va en texto.

Version **1.1.29** — `#ytsearch` ya no dice "No encontré videos" cuando sí hubo resultados: la miniatura se descarga probando `hq720`, `maxresdefault`, `sddefault`, `hqdefault`, `mqdefault` y `default`, y si ninguna sirve manda los resultados en texto. `#play`, `#ytvideo`, `#sp` y `#ams` también descargan y validan la portada antes de enviarla.

Version **1.1.28** — `#img` / `#imagen` ya no manda imágenes rotas (recuadro gris): descarga la imagen, verifica que sea JPEG/PNG real (GIF/WEBP se convierten a JPEG si se puede) y prueba varias fuentes (Google de la API, Bing, Pinterest, DuckDuckGo, Openverse). Si no consigue ninguna, avisa con un mensaje claro.

Version **1.1.27** — El menú y los textos de ayuda/uso muestran el prefijo que está en uso: si cambias el prefijo con `#setbotprefix $`, verás `$menu`, `$rw`, `$apk`, etc. Para volver a los de siempre: `$setbotprefix reset`.

Version **1.1.26** — `#charinfo` (`#winfo`, `#cinfo`) ahora manda la imagen del personaje con la ficha como texto, usando la misma búsqueda que `#rw`. Si no hay imagen válida manda la ficha en texto como antes.

Version **1.1.25** — `#charimage` (`#wimage`, `#cimage`) usa la misma búsqueda de imágenes que `#rw` (Danbooru primero, etiqueta por nombre y serie, API como respaldo y validación de imagen real). Si no hay imagen válida manda solo la ficha en texto en vez de una imagen rota.

Version **1.1.24** — `#rw` busca primero en Danbooru (rápido, solo imágenes seguras) y encuentra la etiqueta correcta por nombre y serie, ej. Karin Uzumaki de Naruto = `karin_(naruto)`. La API lenta queda como respaldo.

Version **1.1.23** — `#rw` prueba hasta 3 personajes: si uno no tiene imagen, saca otro automáticamente sin que tengas que repetir el comando.

Version **1.1.22** — `#rw` ya no manda imágenes rotas: valida que la API devuelva una imagen real (no una página HTML) y, si todas fallan, usa la API pública de Danbooru solo con imágenes seguras. Timeouts de 12 s por petición.

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
