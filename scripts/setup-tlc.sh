#!/usr/bin/env bash
set -eu

mkdir -p .cache
downloaded_jar=$(mktemp .cache/tla2tools.XXXXXXXX)
trap 'rm -f -- "$downloaded_jar"' EXIT

curl -fsSL https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar -o "$downloaded_jar"
printf '%s  %s\n' 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88 "$downloaded_jar" | sha256sum -c -
mv "$downloaded_jar" .cache/tla2tools.jar
