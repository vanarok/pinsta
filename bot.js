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
 * Extracts the Video ID from a YouTube URL.
 * Supports formats: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
 * @param {string} url - The YouTube URL.
 * @returns {string|null} The Video ID or null.
 */
function extractYoutubeId(url) {
    // youtube.com/watch?v=ID
    let match = url.match(/[?&]v=([^&\s]+)/);
    if (match) return match[1];

    // youtu.be/ID
    match = url.match(/youtu\.be\/([^\/?&\s]+)/);
    if (match) return match[1];

    // youtube.com/shorts/ID
    match = url.match(/\/shorts\/([^\/?&\s]+)/);
    if (match) return match[1];

    return null;
}

/**
 * Downloads a video using yt-dlp with size limit for Telegram (50MB).
 * @param {string} url - The video URL (Instagram or YouTube).
 * @param {string} videoId - The video ID for the output filename (can include type prefix).
 * @returns {Promise<string>} The path to the downloaded video.
 */
function downloadVideo(url, videoId) {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        // Replace ':' with '_' for filesystem compatibility
        const safeVideoId = videoId.replace(/:/g, '_');
        const outputPath = path.join(tempDir, `${safeVideoId}.mp4`);

        // Limit video quality to fit within Telegram's 50MB limit
        // Format selection: prefer 720p or lower, with filesize under 50MB
        const command = `yt-dlp -f "best[height<=720][filesize<50M][ext=mp4]/best[height<=480][ext=mp4]/best[ext=mp4]" -o "${outputPath}" "${url}"`;

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
 * Compresses a video to fit within Telegram's 50MB limit.
 * @param {string} videoPath - Path to the original video file.
 * @param {number} targetSizeMB - Target size in MB (default: 45MB for safety margin).
 * @returns {Promise<string>} Path to the compressed video.
 */
function compressVideo(videoPath, targetSizeMB = 45) {
    return new Promise((resolve, reject) => {
        const compressedPath = videoPath.replace('.mp4', '_compressed.mp4');

        // First, get video duration and current bitrate
        const getDurationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;

        exec(getDurationCmd, { timeout: 10000 }, (error, stdout) => {
            if (error) {
                console.error('Duration Detection Error:', error);
                return reject(error);
            }

            const duration = parseFloat(stdout.trim());
            if (!duration || duration <= 0) {
                return reject(new Error('Invalid video duration'));
            }

            // Calculate target bitrate: (target size in bits) / duration
            // Formula: (targetSizeMB * 8 * 1024 * 1024) / duration - audio bitrate
            const audioBitrate = 128; // 128k for audio
            const targetTotalBitrate = (targetSizeMB * 8 * 1024) / duration; // in kbps
            const targetVideoBitrate = Math.floor(targetTotalBitrate - audioBitrate);

            if (targetVideoBitrate < 100) {
                return reject(new Error('Video too long to compress to 50MB'));
            }

            console.log(`Compressing video: duration=${duration.toFixed(1)}s, target video bitrate=${targetVideoBitrate}k`);

            // Compress with calculated bitrate, using fast preset for speed
            const compressCmd = `ffmpeg -i "${videoPath}" -c:v libx264 -preset fast -b:v ${targetVideoBitrate}k -c:a aac -b:a ${audioBitrate}k -movflags +faststart "${compressedPath}"`;

            exec(compressCmd, { timeout: 120000 }, (error) => {
                if (error) {
                    console.error('Compression Error:', error);
                    return reject(error);
                }

                if (fs.existsSync(compressedPath)) {
                    const stats = fs.statSync(compressedPath);
                    const compressedSizeMB = stats.size / (1024 * 1024);
                    console.log(`✅ Video compressed: ${compressedSizeMB.toFixed(2)}MB`);
                    resolve(compressedPath);
                } else {
                    reject(new Error('Compressed file not found'));
                }
            });
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

/**
 * Finds YouTube links in a given text.
 * Supports: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
 * @param {string} text - The text to search.
 * @returns {string[]} An array of found YouTube links.
 */
function findYoutubeLinks(text) {
    const youtubeRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[^\s]+/g;
    return text.match(youtubeRegex) || [];
}

/**
 * Finds all supported video links (Instagram + YouTube) in a given text.
 * @param {string} text - The text to search.
 * @returns {Array<{url: string, type: 'instagram'|'youtube', videoId: string}>} An array of found links with metadata.
 */
function findVideoLinks(text) {
    const links = [];

    // Find Instagram links
    const instagramLinks = findInstagramLinks(text);
    for (const url of instagramLinks) {
        const videoId = extractReelId(url);
        if (videoId) {
            links.push({ url, type: 'instagram', videoId });
        }
    }

    // Find YouTube links
    const youtubeLinks = findYoutubeLinks(text);
    for (const url of youtubeLinks) {
        const videoId = extractYoutubeId(url);
        if (videoId) {
            links.push({ url, type: 'youtube', videoId });
        }
    }

    return links;
}

// --- Bot Logic ---

/**
 * Main message handler.
 */
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    const videoLinks = findVideoLinks(text);
    if (videoLinks.length === 0) return;

    for (const { url, type, videoId } of videoLinks) {
        try {
            await bot.sendChatAction(chatId, 'typing');

            // Create unique cache key with type prefix
            const cacheKey = `${type}:${videoId}`;

            // 1. Check cache
            const cached = await getCachedFileId(cacheKey);
            if (cached) {
                await bot.sendChatAction(chatId, 'upload_video');
                await bot.sendVideo(chatId, cached.fileId, {
                    caption: cached.caption || undefined,
                    reply_to_message_id: msg.message_id
                });
                console.log(`Sent from cache [${type}]: ${videoId}${cached.caption ? ` (caption: "${cached.caption}")` : ''}`);
                continue; // Move to the next link
            }

            // 2. Download if not in cache
            if (!ytDlpAvailable) {
                await bot.sendMessage(chatId, '⚠️ yt-dlp is not available. Cannot download video.');
                continue;
            }

            let videoPath = await downloadVideo(url, cacheKey);
            let compressedPath = null;

            // Check file size (Telegram limit is 50MB)
            const stats = fs.statSync(videoPath);
            const fileSizeMB = stats.size / (1024 * 1024);
            console.log(`Downloaded video size: ${fileSizeMB.toFixed(2)} MB`);

            if (fileSizeMB > 50) {
                try {
                    await bot.sendMessage(chatId, `⚙️ Видео слишком большое (${fileSizeMB.toFixed(1)}MB), сжимаю...`, {
                        reply_to_message_id: msg.message_id
                    });

                    compressedPath = await compressVideo(videoPath);
                    // Use compressed video instead
                    videoPath = compressedPath;
                } catch (compressError) {
                    console.error('Failed to compress video:', compressError);
                    await bot.sendMessage(chatId, `❌ Не удалось сжать видео (${fileSizeMB.toFixed(1)}MB). Слишком большой размер.`, {
                        reply_to_message_id: msg.message_id
                    });
                    // Cleanup
                    fs.unlink(videoPath, (err) => {
                        if (err) console.error('File Cleanup Error:', err);
                    });
                    continue;
                }
            }

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

            const uploadPromise = bot.sendVideo(chatId, fs.createReadStream(videoPath), {
                reply_to_message_id: msg.message_id,
                filename: `video.mp4`
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
                await cacheFileId(cacheKey, sentMessage.video.file_id, caption);
            }

            // 6. Cleanup
            fs.unlink(videoPath, (err) => {
                if (err) console.error('File Cleanup Error:', err);
            });
            // Also cleanup original file if video was compressed
            if (compressedPath) {
                const originalPath = compressedPath.replace('_compressed.mp4', '.mp4');
                if (originalPath !== videoPath && fs.existsSync(originalPath)) {
                    fs.unlink(originalPath, (err) => {
                        if (err) console.error('Original File Cleanup Error:', err);
                    });
                }
            }
            if (framePath) {
                fs.unlink(framePath, (err) => {
                    if (err) console.error('Frame Cleanup Error:', err);
                });
            }

        } catch (error) {
            console.error(`Failed to process link ${url}:`, error);
            await bot.sendMessage(chatId, `❌ Error processing link: ${url}`);
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