# Nexum — Backend Server

## Структура проекту
```
nexum/
├── public/
│   ├── index.html     ← Mini App (те що бачить пацієнт)
│   ├── style.css
│   └── app.js
├── server.js          ← Головний сервер
├── package.json
├── .env.example       ← Шаблон змінних середовища
├── .gitignore
└── README.md
```

## Запуск локально
```bash
npm install
cp .env.example .env   # заповни токени
npm start
```

## Деплой на Render (Web Service)
- Build Command: `npm install`
- Start Command: `node server.js`
- Environment: додай змінні з .env

## Endpoints
- GET  /health     → перевірка що сервер живий
- GET  /           → Mini App
- POST /api/submit → отримує дані опитування
