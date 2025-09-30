require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getCachedFileId, cacheFileId } = require('./database.js');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Initialization ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let ytDlpAvailable = false;
let geminiAvailable = false;
let geminiModel = null;

// Initialize Gemini if API key is provided
if (GEMINI_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        geminiAvailable = true;
        console.log('✅ Gemini 2.5 Flash initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Gemini:', error.message);
        console.log('💡 Check your API key at: https://ai.google.dev/gemini-api/docs/api-key');
    }
} else {
    console.log('⚠️  GEMINI_API_KEY not provided. Captions will not be generated.');
}

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
 * Extracts a frame from the middle of a video file.
 * @param {string} videoPath - Path to the video file.
 * @returns {Promise<string>} Path to the extracted frame.
 */
function extractFirstFrame(videoPath) {
    return new Promise((resolve, reject) => {
        const framePath = videoPath.replace('.mp4', '_frame.jpg');

        // First, get video duration
        const getDurationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;

        exec(getDurationCmd, { timeout: 10000 }, (error, stdout) => {
            if (error) {
                console.error('Duration Detection Error:', error);
                // Fallback to 3 seconds if duration detection fails
                extractFrameAtTime(videoPath, framePath, 3, resolve, reject);
                return;
            }

            const duration = parseFloat(stdout.trim());
            const middleTime = duration / 2;

            console.log(`Video duration: ${duration.toFixed(1)}s, extracting frame at: ${middleTime.toFixed(1)}s`);
            extractFrameAtTime(videoPath, framePath, middleTime, resolve, reject);
        });
    });
}

/**
 * Helper function to extract frame at specific time.
 * Resizes to max 1024px on longest side, preserving aspect ratio.
 */
function extractFrameAtTime(videoPath, framePath, timeInSeconds, resolve, reject) {
    // Extract frame with resizing: max 1024px on longest side, keep aspect ratio
    // scale=-2:1024 if height>width, scale=1024:-2 if width>height
    // -2 maintains divisibility by 2 (required by some codecs)
    const command = `ffmpeg -ss ${timeInSeconds} -i "${videoPath}" -vframes 1 -vf "scale='if(gt(iw,ih),1024,-2)':'if(gt(iw,ih),-2,1024)'" -q:v 5 "${framePath}"`;

    exec(command, { timeout: 10000 }, (error) => {
        if (error) {
            console.error('Frame Extraction Error:', error);
            return reject(error);
        }
        if (fs.existsSync(framePath)) {
            const stats = fs.statSync(framePath);
            console.log(`Frame extracted and compressed: ${(stats.size / 1024).toFixed(1)} KB`);
            resolve(framePath);
        } else {
            reject(new Error('Extracted frame not found.'));
        }
    });
}

/**
 * Generates a short caption (2-3 words) using Gemini Vision.
 * @param {string} imagePath - Path to the image file.
 * @returns {Promise<string>} Generated caption.
 */
async function generateCaption(imagePath) {
    if (!geminiAvailable) {
        return null;
    }

    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');

        const result = await geminiModel.generateContent([
            "Опиши кадр видео максимум 3 словами на русском. Только слова, без точек и лишнего:",
            {
                inlineData: {
                    data: base64Image,
                    mimeType: "image/jpeg"
                }
            }
        ]);

        const caption = result.response.text().trim();
        // Remove punctuation and take first 3 words max
        const cleaned = caption.replace(/[.,!?;:"'«»]/g, '').trim();
        const words = cleaned.split(/\s+/).slice(0, 3);
        return words.join(' ');
    } catch (error) {
        console.error('Caption Generation Error:', error.message);
        return null;
    }
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
            const cached = await getCachedFileId(reelId);
            if (cached) {
                await bot.sendChatAction(chatId, 'upload_video');
                await bot.sendVideo(chatId, cached.fileId, {
                    caption: cached.caption || undefined,
                    reply_to_message_id: msg.message_id
                });
                console.log(`Sent from cache: ${reelId}${cached.caption ? ` (caption: "${cached.caption}")` : ''}`);
                continue; // Move to the next link
            }

            // 2. Download if not in cache
            if (!ytDlpAvailable) {
                await bot.sendMessage(chatId, '⚠️ yt-dlp is not available. Cannot download video.');
                continue;
            }

            const videoPath = await downloadVideo(link, reelId);

            // 3. Generate caption and upload video in parallel
            await bot.sendChatAction(chatId, 'upload_video');

            let caption = null;
            let framePath = null;

            // Start both operations in parallel
            const captionPromise = geminiAvailable ? (async () => {
                try {
                    framePath = await extractFirstFrame(videoPath);
                    caption = await generateCaption(framePath);
                    if (caption) {
                        console.log(`Generated caption: "${caption}"`);
                    }
                    return caption;
                } catch (error) {
                    console.error('Failed to generate caption:', error.message);
                    return null;
                }
            })() : Promise.resolve(null);

            const uploadPromise = bot.sendVideo(chatId, videoPath, {
                reply_to_message_id: msg.message_id
            }, {
                contentType: 'video/mp4'
            });

            // Wait for both to complete
            const [generatedCaption, sentMessage] = await Promise.all([captionPromise, uploadPromise]);

            // 4. If caption was generated, edit message to add it
            if (generatedCaption && sentMessage.message_id) {
                try {
                    await bot.editMessageCaption(generatedCaption, {
                        chat_id: chatId,
                        message_id: sentMessage.message_id
                    });
                    caption = generatedCaption;
                } catch (error) {
                    console.error('Failed to edit caption:', error.message);
                }
            }

            // 5. Cache with caption
            if (sentMessage.video) {
                await cacheFileId(reelId, sentMessage.video.file_id, caption);
            }

            // 6. Cleanup
            fs.unlink(videoPath, (err) => {
                if (err) console.error('File Cleanup Error:', err);
            });
            if (framePath) {
                fs.unlink(framePath, (err) => {
                    if (err) console.error('Frame Cleanup Error:', err);
                });
            }

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