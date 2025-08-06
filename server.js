const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3666;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Простое кэширование в памяти
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Функция для работы с кэшем
function getCachedData(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    cache.delete(key);
    return null;
}

function setCachedData(key, data) {
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}

// Функция для извлечения ID Reels из URL
function extractReelId(url) {
    const reelMatch = url.match(/\/reel\/([^\/\?]+)/);
    const postMatch = url.match(/\/p\/([^\/\?]+)/);
    return reelMatch ? reelMatch[1] : (postMatch ? postMatch[1] : null);
}

// Функция для извлечения данных из Instagram Reels
async function extractReelsData(url, req) {
    try {
        // Получаем HTML страницы Instagram
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // Извлекаем мета-данные
        let title = $('meta[property="og:title"]').attr('content') || 
                   $('title').text() || 
                   'Instagram Reels';
        
        let description = $('meta[property="og:description"]').attr('content') || 
                         $('meta[name="description"]').attr('content') || 
                         'Instagram Reels видео';
        
        let image = $('meta[property="og:image"]').attr('content') || 
                   $('meta[property="og:image:secure_url"]').attr('content');
        
        let video = $('meta[property="og:video"]').attr('content') || 
                   $('meta[property="og:video:secure_url"]').attr('content');
        
        let videoType = $('meta[property="og:video:type"]').attr('content') || 'video/mp4';

        // Если нет изображения, используем дефолтное
        if (!image) {
            image = `${req.protocol}://${req.get('host')}/default-thumbnail.jpg`;
        }

        // Если нет видео, создаем embed URL
        if (!video) {
            const reelId = extractReelId(url);
            if (reelId) {
                video = `https://www.instagram.com/p/${reelId}/embed/`;
            }
        }

        return {
            title: title.replace(/['"<>]/g, ''),
            description: description.replace(/['"<>]/g, ''),
            image,
            video,
            videoType,
            originalUrl: url
        };
    } catch (error) {
        console.error('Ошибка при извлечении данных:', error.message);
        return null;
    }
}

// Функция для генерации HTML страницы
function generateHTML(reelsData, req) {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- Open Graph мета-теги для Telegram -->
    <meta property="og:title" content="${reelsData.title}">
    <meta property="og:description" content="${reelsData.description}">
    <meta property="og:type" content="video.other">
    <meta property="og:url" content="${req.protocol}://${req.get('host')}${req.originalUrl}">
    <meta property="og:site_name" content="Instagram Reels">
    <meta property="og:locale" content="ru_RU">
    ${reelsData.image ? `<meta property="og:image" content="${reelsData.image}">` : ''}
    ${reelsData.video ? `<meta property="og:video" content="${reelsData.video}">` : ''}
    ${reelsData.video ? `<meta property="og:video:secure_url" content="${reelsData.video}">` : ''}
    ${reelsData.videoType ? `<meta property="og:video:type" content="${reelsData.videoType}">` : ''}
    ${reelsData.video ? `<meta property="og:video:width" content="1080">` : ''}
    ${reelsData.video ? `<meta property="og:video:height" content="1920">` : ''}
    ${reelsData.video ? `<meta property="og:video:duration" content="30">` : ''}
    
    <title>${reelsData.title}</title>
    
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #000;
            font-family: Arial, sans-serif;
        }
        .video-container {
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .video-player {
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        }
        .fallback {
            color: white;
            text-align: center;
            padding: 20px;
        }
    </style>
</head>
<body>
    <div class="video-container">
        ${reelsData.video ? `
        <iframe src="${reelsData.video}" class="video-player" frameborder="0" allowfullscreen></iframe>
        ` : `
        <div class="fallback">
            <h2>${reelsData.title}</h2>
            <p>${reelsData.description}</p>
            <a href="${reelsData.originalUrl}" target="_blank" style="color: #667eea;">Открыть в Instagram</a>
        </div>
        `}
    </div>
</body>
</html>`;
}

// Роут для дефолтного изображения
app.get('/default-thumbnail.jpg', (req, res) => {
    const svg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="400" fill="#667eea"/>
        <text x="200" y="200" font-family="Arial" font-size="24" fill="white" text-anchor="middle" dominant-baseline="middle">
            Instagram Reels
        </text>
    </svg>`;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
});

// Основной роут для Telegram
app.get('/tg/:reelId', async (req, res) => {
    const { reelId } = req.params;
    const instagramUrl = `https://www.instagram.com/reel/${reelId}/`;
    
    try {
        // Проверяем кэш
        const cachedData = getCachedData(reelId);
        let reelsData;
        
        if (cachedData) {
            reelsData = cachedData;
        } else {
            reelsData = await extractReelsData(instagramUrl, req);
            if (reelsData) {
                setCachedData(reelId, reelsData);
            }
        }
        
        if (!reelsData) {
            return res.status(404).send('Не удалось получить данные Reels');
        }

        // Создаем HTML страницу с Open Graph мета-тегами
        const html = generateHTML(reelsData, req);
        res.send(html);
        
    } catch (error) {
        console.error('Ошибка сервера:', error);
        res.status(500).send('Внутренняя ошибка сервера');
    }
});

// Главная страница
app.get('/', (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Instagram Reels Proxy</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            border-radius: 15px;
            padding: 40px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            max-width: 600px;
            text-align: center;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        .example {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .example h3 {
            margin-top: 0;
            color: #333;
        }
        .example a {
            color: #667eea;
            text-decoration: none;
        }
        .example a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Instagram Reels Proxy</h1>
        <p>Сервис для проксирования Instagram Reels с поддержкой Open Graph</p>
        
        <div class="example">
            <h3>Пример использования:</h3>
            <p>Оригинальная ссылка:</p>
            <a href="https://www.instagram.com/reel/DMziLlstNg2/?igsh=YXM1eWpybm8yM29o" target="_blank">
                https://www.instagram.com/reel/DMziLlstNg2/?igsh=YXM1eWpybm8yM29o
            </a>
            <p>Прокси ссылка для Telegram:</p>
            <a href="/tg/DMziLlstNg2" target="_blank">
                ${req.protocol}://${req.get('host')}/tg/DMziLlstNg2
            </a>
        </div>
    </div>
</body>
</html>`;
    
    res.send(html);
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Главная страница: http://localhost:${PORT}`);
    console.log(`Пример: http://localhost:${PORT}/tg/DMziLlstNg2`);
}); 