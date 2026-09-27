# Luffy7 WhatsApp en Railway (numero NUEVO, sin Termux)

Repo nube: https://github.com/BerNardo77-bot/Andrewmisses-olo
Codigo (Termux): https://github.com/BerNardo77-bot/Luffy7
Version: 1.1.22

Esto NO es Telegram. WhatsApp no usa BotFather.
Hace falta OTRO numero (otro chip / otra cuenta). El de Yampi en Termux se queda.
Si usas el mismo numero, los comandos salen 2 veces y WhatsApp puede banear.

No uses Cajas de arena. Unexposed service esta bien.
Hace falta un Volume o cada redeploy pide vincular otra vez.

---

## 1. Numero nuevo

1. Un WhatsApp distinto al de Termux (otro chip o WhatsApp Business).
2. Anota el numero: codigo de pais + numero, SIN +.
   Mexico ejemplo: 5215512345678

---

## 2. GitHub + Railway

La app de Railway hoy solo ve bbboy. Hay que agregar Andrewmisses-olo (no Luffy7, no bbboy).

1. GitHub → Settings → Applications → Installed → Railway → Configure
2. Repository access → Select repositories → agrega Andrewmisses-olo
3. Save

Luego:

1. https://railway.app (cuenta BerNardo77-bot)
2. Proyectos → Nuevo
3. Implemente un repositorio de GitHub
4. Elige Andrewmisses-olo (main). No sandbox, no bbboy, no Luffy7.

---

## 3. Volume (obligatorio)

Sin esto, al redesplegar se pierde la sesion.

1. En el servicio Andrewmisses-olo → Settings o Volumes
2. New Volume
3. Mount path: /data
4. Add

---

## 4. Variables (New Variable, 4 veces)

Name NO es el nombre del bot.

1. WHATSAPP_NUMBER = 5215512345678
   (tu numero NUEVO, pais+numero, sin +)
2. OWNER_NUMBER = el mismo numero
3. DATA_DIR = /data
4. NSFW_ENABLED no aplica igual; la API ya esta en settings.js (LUFFY-FIX67)

Si Railway ya inyecto PORT, dejalo.

Overwrite detected → Cancel si esa variable ya existe.

### Búsqueda web (`#google`) — variables opcionales

Sin configurar nada, `#google` usa buscadores sin API key: DuckDuckGo → Seznam → Mwmbl → Marginalia → Bing → Wikipedia (en servidores DuckDuckGo y Bing suelen pedir captcha; se saltan solos). Si quieres resultados tipo Google/Brave desde el servidor, agrega **una** de estas (van primero cuando existen):

| Variable | Valor |
|---|---|
| `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | API key y el ID del buscador de Google Programmable Search (Custom Search JSON API) |
| `BRAVE_API_KEY` | Token de Brave Search API (https://brave.com/search/api/) |
| `SEARCH_DISABLE` | (opcional) motores a desactivar, separados por coma: `duckduckgo,seznam,mwmbl,marginalia,bing` |

---

## 5. Deploy y vincular

1. Apply 1 change o Deploy
2. Deployments → ultimo → Logs
3. Espera:
   CODIGO WHATSAPP (8 digitos): XXXX-XXXX
4. En el celular del numero NUEVO:
   WhatsApp → Dispositivos vinculados → Vincular con el numero de telefono
   Pega el codigo de 8 digitos (a veces sin guion).
5. Logs: conexion open / bot listo.
6. Escribe al numero nuevo: #ping  #menu

El codigo caduca rapido. Si expiro: Redeploy y usa el codigo nuevo.

---

## 6. Render (alternativa)

Background Worker (plan de pago), Docker, mismas variables.
Persistent Disk montado en /data.
Logs: mismo codigo de 8 digitos.

Web Service gratis se duerme: no sirve.

---

## Si algo falla

El proceso se queda sin codigo: falta WHATSAPP_NUMBER o hay creds rotas.
Borra el Volume solo si quieres vincular de cero (perderas gacha).

QR en logs: en nube usamos codigo, no QR.

Comandos 2 veces: Termux y Railway con el MISMO numero. Apaga Termux de ese numero o usa otro chip.

Ban de WhatsApp: las cuentas no oficiales a veces caen. Empieza en un numero que no te importe perder.

Trial 30 dias / $5: si se acaba, el bot se apaga; el Volume guarda la sesion.

---

## Actualizar

Push a main en Andrewmisses-olo. Railway redespliega.
No borres el Volume.
Termux de Yampi no se toca.
