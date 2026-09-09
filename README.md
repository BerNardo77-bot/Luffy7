# Luffy7 — Monkey D. Luffy Bot MD

Version **1.1.5** — #menu: si el CDN del banner falla (429), manda el menu en texto.

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
git pull
npm install
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
