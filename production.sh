#!/bin/bash
set -e

ARCHIVE="media-$(date +%Y%m%d%H%M%S).tar.gz"

tar -czf "$ARCHIVE" \
  server.js \
  package.json \
  package-lock.json \
  Dockerfile \
  docker-compose.yml \
  public/

echo "Created: $ARCHIVE"
echo ""
echo "Contents:"
tar -tzf "$ARCHIVE"
echo ""
echo "Deploy to server:"
echo "  scp $ARCHIVE user@host:~/"
echo "  ssh user@host"
echo "  tar -xzf $ARCHIVE"
echo "  cp .env.production .env   # add your secrets"
echo "  docker compose up -d --build"
