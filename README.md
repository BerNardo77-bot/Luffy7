# Luffy7 — Monkey D. Luffy Bot MD

Bot de WhatsApp (Node.js + Baileys) para **BerNardo77-bot/Luffy7**.
Basado en [nene504273/Monkey-D-luffy-Bot-MD](https://github.com/nene504273/Monkey-D-luffy-Bot-MD).

Proyecto independiente; no afiliado a WhatsApp Inc.

## Descargas activadas

| Comando | Alias | Uso |
|--------|--------|-----|
| `/play` | `/mp3`, `/ytmp3` | YouTube audio |
| `/play2` | `/mp4`, `/ytmp4` | YouTube video |
| `/tiktok` | `/tt` | TikTok |
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
Si stickers fallan: `npm install sharp @eimg/sharp-wasm32

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
