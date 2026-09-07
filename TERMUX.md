# Termux — Luffy7 WhatsApp

## Error EBADPLATFORM (sharp-wasm32)

El telefono reporta cpu arm64; ese paquete pide wasm32.

Que hacer:
1. Reemplaza package.json por la version de main en GitHub
2. Elimina package-lock.json
3. Instala dependencias omitiendo opcionales
4. Si quieres stickers, fuerza instalacion del paquete sharp-wasm32 0.33.5 con cpu wasm32
5. Arranca el bot y escanea el QR

## Error 401 desvinculado

WhatsApp cerro la sesion. Arranca de nuevo y vincula el QR.

## Archivos importantes ya en el repo

- package.json v1.1.0 (sharp-wasm32 opcional)
- cmds/nsfw/inter.js (reintentos)
- cmds/sticker/stickerpack.js (sharp lazy)
