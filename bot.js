const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getCachedFileId, cacheFileId } = require('./database.js');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;

// --- Initialization ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let ytDlpAvailable = false;

// --- Helper Functions ---

/**
 * Extracts the Reel ID from an Instagram URL.
 * @param {string} url - The Instagram URL.
 * @returns {string|null} The Reel ID or null.
 */
function extractReelId(url) {
    const match = url.match(/\/(?:p|reel)\/([^\/?]+)/);
    return match ? match[1] : null;
}

/**
 * Downloads a video using yt-dlp.
 * @param {string} url - The video URL.
 * @param {string} reelId - The Reel ID for the output filename.
 * @returns {Promise<string>} The path to the downloaded video.
 */
function downloadVideo(url, reelId) {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const outputPath = path.join(tempDir, `${reelId}.mp4`);
        const command = `yt-dlp -f "best[ext=mp4]/best" -o "${outputPath}" "${url}"`;

        exec(command, { timeout: 60000 }, (error) => {
            if (error) {
                console.error('Download Error:', error);
                return reject(error);
            }
            if (fs.existsSync(outputPath)) {
                resolve(outputPath);
            } else {
                reject(new Error('Downloaded file not found.'));
            }
        });
    });
}

/**
 * Finds Instagram links in a given text.
 * @param {string} text - The text to search.
 * @returns {string[]} An array of found Instagram links.
 */
function findInstagramLinks(text) {
    const instagramRegex = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[^\/\s]+/g;
    return text.match(instagramRegex) || [];
}

// --- Bot Logic ---

/**
 * Main message handler.
 */
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    const instagramLinks = findInstagramLinks(text);
    if (instagramLinks.length === 0) return;

    for (const link of instagramLinks) {
        const reelId = extractReelId(link);
        if (!reelId) continue;

        try {
            await bot.sendChatAction(chatId, 'typing');

            // 1. Check cache
            const cachedFileId = await getCachedFileId(reelId);
            if (cachedFileId) {
                await bot.sendChatAction(chatId, 'upload_video');
                await bot.sendVideo(chatId, cachedFileId, { caption: `From cache: [Original Post](${link})`, parse_mode: 'Markdown' });
                continue; // Move to the next link
            }

            // 2. Download if not in cache
            if (!ytDlpAvailable) {
                await bot.sendMessage(chatId, '⚠️ yt-dlp is not available. Cannot download video.');
                continue;
            }
            
            const videoPath = await downloadVideo(link, reelId);

            // 3. Send and cache
            await bot.sendChatAction(chatId, 'upload_video');
            const sentMessage = await bot.sendVideo(chatId, videoPath, {
                caption: `[Original Post](${link})`,
                parse_mode: 'Markdown'
            });
            
            if (sentMessage.video) {
                await cacheFileId(reelId, sentMessage.video.file_id);
            }

            // 4. Cleanup
            fs.unlink(videoPath, (err) => {
                if (err) console.error('File Cleanup Error:', err);
            });

        } catch (error) {
            console.error(`Failed to process link ${link}:`, error);
            await bot.sendMessage(chatId, `❌ Error processing link: ${link}`);
        }
    }
});

// --- Bot Startup ---

/**
 * Checks if yt-dlp is installed and available.
 */
async function checkYtDlp() {
    return new Promise((resolve) => {
        exec('yt-dlp --version', (error, stdout) => {
            if (error) {
                console.error('❌ yt-dlp not found. Please install it.');
                resolve(false);
            } else {
                console.log(`✅ yt-dlp found, version: ${stdout.trim()}`);
                resolve(true);
            }
        });
    });
}

/**
 * Starts the bot.
 */
async function startBot() {
    console.log('🤖 Starting Telegram bot...');
    ytDlpAvailable = await checkYtDlp();
    if (!ytDlpAvailable) {
        console.log('⚠️ Running in fallback mode. Only cached videos will be sent.');
    }
    console.log('💡 Bot is ready and listening for messages.');
}

startBot();

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    bot.stopPolling();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down bot...');
    bot.stopPolling();
    process.exit(0);
});