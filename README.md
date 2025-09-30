# Instagram Reels Proxy + Telegram Bot

Сервис для проксирования Instagram Reels с поддержкой Open Graph мета-тегов и Telegram бот для автоматической конвертации ссылок.

## 🐳 Docker

### Быстрый запуск с Docker

1. Склонируйте репозиторий:
```bash
git clone <repository-url>
cd pinsta
```

2. Создайте файл `.env` с вашим токеном бота:
```bash
echo "BOT_TOKEN=your_telegram_bot_token_here" > .env
```

3. Запустите с помощью Docker Compose:
```bash
# Запуск только бота
docker-compose up instagram-reels-bot

# Запуск только веб-сервера
docker-compose up instagram-reels-server

# Запуск обоих сервисов
docker-compose up
```

### Запуск с Docker без Docker Compose

1. Соберите образ:
```bash
docker build -t instagram-reels-bot .
```

2. Запустите контейнер:
```bash
# Запуск бота
docker run -d \
  --name instagram-reels-bot \
  -e BOT_TOKEN=your_telegram_bot_token_here \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/reels_cache.db:/app/reels_cache.db \
  instagram-reels-bot

# Запуск веб-сервера
docker run -d \
  --name instagram-reels-server \
  -p 3666:3666 \
  -v $(pwd)/data:/app/data \
  instagram-reels-bot npm start
```

### Переменные окружения

- `BOT_TOKEN` - токен вашего Telegram бота (обязательно для бота)
- `GEMINI_API_KEY` - API ключ Google Gemini для авто-генерации заголовков видео (опционально)
  - Получить бесплатно: https://ai.google.dev/gemini-api/docs/api-key
  - Лимит: 1500 запросов/день бесплатно
- `NODE_ENV` - окружение (production/development)
- `PORT` - порт для веб-сервера (по умолчанию 3666)

### Volumes

- `./data:/app/data` - директория для данных
- `./reels_cache.db:/app/reels_cache.db` - база данных кэша (для бота)

---

## Возможности

### 🌐 Веб-сервис
- 📱 Извлечение мета-данных из Instagram Reels
- 🔗 Создание прокси-ссылок с Open Graph поддержкой
- 📺 Отображение превью в Telegram, WhatsApp и других приложениях
- 🎥 Встроенный видео-плеер
- 📱 Адаптивный дизайн

### 🤖 Telegram Бот
- 🔍 Автоматическое обнаружение Instagram ссылок в чате
- 🔄 Автоматическая конвертация в прокси-ссылки
- 📺 Встроенное воспроизведение видео в Telegram
- 🤖 **AI-генерация заголовков** (2-3 слова) через Gemini Flash
- 💬 Поддержка групповых чатов
- ⚡ Быстрая обработка сообщений
- 💾 Кэширование видео в SQLite (без повторного скачивания)

## Установка

1. Установите зависимости:
```bash
npm install
```

2. Запустите сервер:
```bash
npm start
```

Для разработки с автоматической перезагрузкой:
```bash
npm run dev
```

Сервер будет доступен по адресу: `http://localhost:3666`

## Использование

### 1. Через веб-интерфейс

Откройте `http://localhost:3666` и вставьте ссылку на Instagram Reels в форму.

### 2. Прямые ссылки

Замените оригинальную ссылку Instagram на прокси-ссылку:

**Оригинал:**
```
https://www.instagram.com/reel/DMziLlstNg2/?igsh=YXM1eWpybm8yM29o
```

**Прокси:**
```
http://localhost:3666/reels/DMziLlstNg2
```

### 3. API

Используйте параметр `url` для автоматического редиректа:
```
http://localhost:3666/proxy?url=https://www.instagram.com/reel/DMziLlstNg2/?igsh=YXM1eWpybm8yM29o
```

## API Endpoints

- `GET /` - Главная страница с формой
- `GET /reels/:reelId` - Прокси страница для конкретного Reels
- `GET /tg/:reelId` - **Специальная страница для Telegram с встроенным видео**
- `GET /ytdlp/:reelId` - **Прямое видео через yt-dlp (рекомендуется)**
- `GET /ytdlp-info/:reelId` - Информация о видео через yt-dlp
- `GET /video/:reelId` - Страница с iframe для встроенного видео
- `GET /direct-video/:reelId` - Прямая ссылка на видео файл
- `GET /embed/:reelId` - Embed iframe от Instagram
- `GET /video-proxy?url=...` - Проксирование видео файлов
- `GET /proxy?url=...` - Автоматический редирект по полному URL

## Примеры

### Telegram
Для встроенного воспроизведения видео в Telegram используйте специальный роут:
```
http://localhost:3666/tg/DMziLlstNg2
```

### Прямое видео через yt-dlp
Для получения прямого видео (рекомендуется):
```
http://localhost:3666/ytdlp/DMziLlstNg2
```

### Обычная прокси-ссылка
Только превью (без yt-dlp):
```
http://localhost:3666/reels/DMziLlstNg2
```

### WhatsApp
Используйте ту же ссылку в WhatsApp для отображения превью.

## Структура проекта

```
├── server.js          # Основной серверный файл
├── package.json       # Зависимости проекта
└── README.md         # Документация
```

## Технические детали

- **Express.js** - веб-сервер
- **Axios** - HTTP-клиент для запросов к Instagram
- **Cheerio** - парсинг HTML и извлечение мета-данных
- **Open Graph** - мета-теги для превью в соцсетях

## Ограничения

- Instagram может блокировать частые запросы
- Некоторые Reels могут быть приватными
- Видео-контент может быть недоступен из-за CORS
- **Важно**: Для получения видео нужен Instagram API токен (см. INSTAGRAM_API_SETUP.md)

## Решение проблемы с видео

Instagram блокирует прямые запросы к видео. Для получения видео:

1. **Используйте yt-dlp (рекомендуется)** (см. YTDLP_SETUP.md):
   ```
   http://localhost:3666/ytdlp/DMziLlstNg2
   ```
   - Установите yt-dlp: `pip install yt-dlp`
   - Получает прямые ссылки на видео
   - Обходит ограничения Instagram

2. **Используйте embed iframe** (работает без токена):
   ```
   http://localhost:3666/reels/DMziLlstNg2
   ```

3. **Настройте Instagram API** (см. INSTAGRAM_API_SETUP.md):
   - Получите access token
   - Добавьте в переменные окружения
   - Обновите код в server.js

4. **Альтернативные решения**:
   - Используйте сторонние API (RapidAPI, Apify)
   - Проксирование через наш сервер

## Развертывание

Для продакшена рекомендуется:

1. Использовать HTTPS
2. Настроить кэширование
3. Добавить rate limiting
4. Использовать прокси-сервер (nginx)

## Лицензия

No License