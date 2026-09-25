# Luffy7 WhatsApp — arranque desde cero en Termux

Bot: Yampi (WhatsApp)
Repo: https://github.com/BerNardo77-bot/Luffy7
Version: 1.1.19
Prefijo: #  (ejemplo: #menu #ping #apk)

Usa Termux de F-Droid, no el de Play Store.
Cada bloque es un comando. Copialo, pegalo y da Enter. Espera a que termine antes del siguiente.

NO cierres "Dispositivos vinculados" en WhatsApp. Eso desconecta la sesion.
Si hay que reiniciar el bot: mata Node, no borres la carpeta Sessions.

---

## 1. Actualiza paquetes

```
pkg update
```

```
pkg upgrade -y
```

Si node, ffmpeg o yt-dlp dicen cannot locate symbol:

```
pkg install libc++ openssl
```

Cierra Termux por completo y abrelo de nuevo. Luego:

```
pkg reinstall nodejs-lts ffmpeg
```

---

## 2. Instala lo necesario

```
pkg install git
```

```
pkg install nodejs-lts
```

```
pkg install ffmpeg
```

```
pkg install python
```

```
pkg install yt-dlp
```

```
pkg install imagemagick
```

```
termux-setup-storage
```

(Acepta el permiso de archivos si lo pide.)

---

## 3. Clona el repo

```
cd ~
```

```
git clone https://github.com/BerNardo77-bot/Luffy7.git
```

Si ya existe ~/Luffy7 y quieres CONSERVAR la sesion (QR ya escaneado), no borres la carpeta. Salta al paso de actualizar.

```
cd ~/Luffy7
```

```
node -p "require('./package.json').version"
```

Debe salir: 1.1.19

---

## 4. Settings (dueno y API)

```
cd ~/Luffy7
```

```
nano settings.js
```

Busca estas lineas y dejalo asi (cambia solo TU numero, codigo de pais + numero, SIN el +):

```
global.owner = ['5215512345678']

global.api = {
  url: 'https://api.alyacore.xyz',
  key: 'LUFFY-FIX67'
}
```

Guarda: Ctrl+O, Enter, Ctrl+X.

---

## 5. Cierra otros Node (no toques WhatsApp)

Solo un proceso Node del bot. Si hay dos, cada comando sale 2 veces.

```
pkill -9 -f node || true
```

NO uses "cerrar sesion" ni borres dispositivos vinculados.

---

## 6. Instala y arranca

```
cd ~/Luffy7
```

```
npm install
```

Si sharp falla (stickers):

```
npm install @img/sharp-wasm32
```

```
npm start
```

La primera vez te pregunta como conectar:

1 = Codigo QR
2 = Codigo de 8 digitos

Opcion 1: WhatsApp del celular → Dispositivos vinculados → Vincular un dispositivo → escanea el QR de Termux.

Opcion 2: escribe tu numero con + (ejemplo +52155...), te da un codigo de 8 digitos. En WhatsApp: Dispositivos vinculados → Vincular con el numero de telefono.

Cuando conecte, deja Termux abierto. No cierres la sesion.

---

## 7. Prueba

En WhatsApp (chat privado contigo o un grupo donde este el bot):

1. #menu
2. #ping
3. #apk WhatsApp
4. #rw

#apk de un juego grande (GTA 206 MB) te da el LINK. Abrelo en el navegador; WhatsApp no sube APKs de mas de ~90 MB.

---

## 8. En un grupo (un admin)

Los que vienen apagados:

```
#nsfw enable
```

```
#gacha enable
```

```
#rpg enable
```

NO actives antilink ni adminonly: esos bloquean comandos.

---

## Actualizar (si ya lo tenias instalado)

No borres ~/Luffy7. Ahi estan Sessions (QR) y la base de datos.

```
cd ~/Luffy7
```

```
pkill -9 -f node || true
```

```
git fetch origin
```

```
git reset --hard origin/main
```

```
node -p "require('./package.json').version"
```

Debe salir 1.1.19

Si tocaste settings.js, vuelve a poner tu numero en global.owner (el reset lo deja vacio).

```
npm start
```

---

## Si algo falla

cannot locate symbol: pkg install libc++ openssl, cierra Termux, reabre, pkg reinstall nodejs-lts ffmpeg.

El prompt quedo en > : te metiste a Node. Escribe .exit y Enter.

Comando sale 2 veces: hay 2 procesos. pkill -9 -f node || true y un solo npm start.

Se desconecto y pide QR otra vez: borraste Sessions o cerraste el dispositivo vinculado. No lo hagas. Escanea de nuevo solo si ya no hay sesion.

401 / API: en settings.js la key debe ser LUFFY-FIX67.

Spotify: deja un espacio. Ejemplo: #sp https://open.spotify.com/track/...

No uses curl a raw.githubusercontent.com (429). Actualiza solo con git fetch + git reset --hard origin/main.
