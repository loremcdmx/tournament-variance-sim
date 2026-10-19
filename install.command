#!/bin/bash
# Двойной клик по этому файлу в Finder (или `bash install.command` в Terminal)
# развернёт проект: .git (если рядом лежит git-data.tar.gz), зависимости, Vercel.
set -e
cd "$(dirname "$0")"

if [ -f git-data.tar.gz ]; then
  echo "==> Распаковываю .git из git-data.tar.gz"
  tar -xzf git-data.tar.gz
  rm -f git-data.tar.gz
else
  echo "==> git-data.tar.gz нет, .git не трогаю (обычный клон)"
fi

echo "==> git status"
git status

echo "==> npm install"
if ! command -v npm >/dev/null 2>&1; then
  echo "Node/npm не найден. Поставь Node 24 LTS (nvm install, версия в .nvmrc) и перезапусти."
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
