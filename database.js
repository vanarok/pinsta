const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./reels_cache.db');

// Создаем таблицу для кэша, если она не существует
db.serialize(() => {
    // Создаем таблицу с новым полем caption
    db.run(`CREATE TABLE IF NOT EXISTS cache (
        reel_id TEXT PRIMARY KEY,
        file_id TEXT,
        caption TEXT
    )`);

    // Добавляем колонку caption, если она не существует (для старых БД)
    db.run("ALTER TABLE cache ADD COLUMN caption TEXT", (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding caption column:', err);
        }
    });
});

/**
 * Получает данные из кэша по reel_id
 * @param {string} reelId - ID рилса
 * @returns {Promise<{fileId: string, caption: string}|null>} - данные или null
 */
function getCachedFileId(reelId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT file_id, caption FROM cache WHERE reel_id = ?", [reelId], (err, row) => {
            if (err) {
                console.error('Ошибка чтения из БД:', err);
                return resolve(null);
            }
            if (row) {
                resolve({ fileId: row.file_id, caption: row.caption || null });
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Сохраняет file_id и caption в кэш
 * @param {string} reelId - ID рилса
 * @param {string} fileId - file_id видео в Telegram
 * @param {string|null} caption - заголовок видео (опционально)
 */
function cacheFileId(reelId, fileId, caption = null) {
    db.run(
        "INSERT OR REPLACE INTO cache (reel_id, file_id, caption) VALUES (?, ?, ?)",
        [reelId, fileId, caption],
        (err) => {
            if (err) {
                console.error('Ошибка записи в БД:', err);
            } else {
                console.log(`Кэширован reel_id: ${reelId}${caption ? ` (caption: "${caption}")` : ''}`);
            }
        }
    );
}

module.exports = {
    getCachedFileId,
    cacheFileId
};