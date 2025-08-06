const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./reels_cache.db');

// Создаем таблицу для кэша, если она не существует
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS cache (reel_id TEXT PRIMARY KEY, file_id TEXT)");
});

/**
 * Получает file_id из кэша по reel_id
 * @param {string} reelId - ID рилса
 * @returns {Promise<string|null>} - file_id или null, если не найден
 */
function getCachedFileId(reelId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT file_id FROM cache WHERE reel_id = ?", [reelId], (err, row) => {
            if (err) {
                console.error('Ошибка чтения из БД:', err);
                return resolve(null); // При ошибке просто возвращаем null
            }
            resolve(row ? row.file_id : null);
        });
    });
}

/**
 * Сохраняет file_id в кэш
 * @param {string} reelId - ID рилса
 * @param {string} fileId - file_id видео в Telegram
 */
function cacheFileId(reelId, fileId) {
    db.run("INSERT OR REPLACE INTO cache (reel_id, file_id) VALUES (?, ?)", [reelId, fileId], (err) => {
        if (err) {
            console.error('Ошибка записи в БД:', err);
        } else {
            console.log(`Кэширован reel_id: ${reelId}`);
        }
    });
}

module.exports = {
    getCachedFileId,
    cacheFileId
};