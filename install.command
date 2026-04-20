#!/bin/bash
# Двойной клик по этому файлу в Finder (или `bash install.command` в Terminal)
# развернёт проект: .git, зависимости, Vercel.
set -e
cd "$(dirname "$0")"

echo "==> Распаковываю .git из git-data.tar.gz"
tar -xzf git-data.tar.gz
rm -f git-data.tar.gz

echo "==> git status"
git status

echo "==> npm install"
if ! command -v npm >/dev/null 2>&1; then
  echo "Node/npm не найден. Поставь Node 22 (nvm install 22) и перезапусти."
  exit 1
fi
npm install

echo "==> Vercel link (войди и выбери существующий проект tournament-variance-sim)"
if ! command -v vercel >/dev/null 2>&1; then
  echo "Ставлю Vercel CLI глобально..."
  npm i -g vercel
fi
vercel link || echo "(vercel link можно запустить позже вручную)"

echo ""
echo "==> Готово."
echo "   cd \"$(pwd)\""
echo "   npm run dev     # http://localhost:3000"
echo "   git push         # пуш как обычно"
