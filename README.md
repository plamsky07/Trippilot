# Trippilot

Trippilot е уеб система с `Node.js` и `TypeScript` за организиране на ученически екскурзии, посещения на музеи, зелени училища и други училищни събития.

## Какво вече работи

- регистрация и вход
- роли `Student`, `Teacher`, `Parent`, `Admin`
- създаване, редакция и отмяна на ученически събития
- записване и отписване на ученик
- детайлна страница за събитие
- търсене и филтриране по име, категория и дата
- списък с участници
- родителско потвърждение
- payment status и seat plan
- admin страници за потребители, статистика и audit log
- запис и четене от база данни
- автоматизиран smoke test

## Технологии

- `Node.js`
- `TypeScript`
- `Express`
- `EJS`
- `sql.js` със запис във файлова SQLite база
- `supertest` за автоматизиран тест

## Стартиране

1. Инсталирай зависимостите:

```bash
npm install
```

2. Копирай `.env.example` в `.env` при нужда и промени стойностите:

```env
PORT=3000
SESSION_SECRET=trippilot-dev-secret
DB_PATH=data/trippilot.sqlite
```

3. Стартирай development сървъра:

```bash
npm run dev
```

4. Production build:

```bash
npm run build
npm start
```

## Тест

```bash
npm test
```

Тестът проверява реален поток:

- ученик влиза
- записва се за ученическа екскурзия
- вижда обновен статус на регистрацията

## Demo акаунти

- `admin@trippilot.local` / `Admin123!`
- `teacher@trippilot.local` / `Teacher123!`
- `student@trippilot.local` / `Student123!`
- `parent@trippilot.local` / `Parent123!`

## Основни файлове

- `src/app.ts` - основните routes и бизнес логика
- `src/db/database.ts` - базата, schema и seed данни
- `views/` - EJS страниците
- `public/styles.css` - стилове
- `tests/smoke.ts` - автоматизиран тест
- `docs/` - backlog, sprint plan и Definition of Done
