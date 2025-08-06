# Используем официальный образ Node.js
FROM node:18-alpine

# Устанавливаем необходимые пакеты
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    yt-dlp

# Создаем рабочую директорию
WORKDIR /app

# Копируем файлы package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Создаем директорию для базы данных
RUN mkdir -p /app/data

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S bot -u 1001

# Меняем владельца файлов
RUN chown -R bot:nodejs /app
USER bot

# Открываем порт для веб-сервера
EXPOSE 3666

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=3666

# Команда по умолчанию - запуск бота
CMD ["npm", "run", "bot"] 