#!/bin/sh
# Compila l'APK di release firmato. La password della chiave viene chiesta
# qui e passata a Gradle solo come variabile d'ambiente: non finisce su
# disco né nella cronologia della shell.
set -e
cd "$(dirname "$0")"

if [ ! -f android/keystore.properties ]; then
  echo "Manca android/keystore.properties (storeFile e keyAlias): vedi README." >&2
  exit 1
fi

# Capacitor 8 vuole Java 21, mentre il JAVA_HOME della shell può puntare a
# un'altra versione usata da altri progetti: qui si forza il 21.
# LEROY_JAVA_HOME permette di indicarne un altro.
JAVA_HOME="${LEROY_JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

if [ -z "$LEROY_KEYSTORE_PASSWORD" ]; then
  printf 'Password della chiave: '
  stty -echo
  read -r LEROY_KEYSTORE_PASSWORD
  stty echo
  printf '\n'
fi
export LEROY_KEYSTORE_PASSWORD

npm run sync
cd android
./gradlew assembleRelease
echo
echo "APK firmato: $(pwd)/app/build/outputs/apk/release/app-release.apk"
