# Luffy7 Termux desde cero
Version 1.1.1
Repo https://github.com/BerNardo77-bot/Luffy7
## 1. Arreglar node y ffmpeg
Cerra Termux despues de instalar libc++ y openssl.
pkg update -y
pkg install -y libc++ openssl
node -v
Si node falla: pkg reinstall openssl nodejs-lts
Si ffmpeg no instala: pkg remove -y ffmpeg
luego pkg upgrade -y y pkg install -y ffmpeg
## 2. Clonar
cd ~
git clone https://github.com/BerNardo77-bot/Luffy7.git
cd ~/Luffy7
## Dependencias y arranque
Arrancar el bot y escanear el QR.
