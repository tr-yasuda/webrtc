#!/usr/bin/env bash
set -eu

find packages -type f -path '*/specs/*.tla' -print0 |
  xargs -0 -r -n1 java -jar .cache/tla2tools.jar
