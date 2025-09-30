# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Instagram Reels Proxy with Telegram Bot - a service that proxies Instagram Reels with Open Graph meta tags support and automatically downloads videos via Telegram bot.

## Architecture

The project consists of two independent services:

1. **Web Server** ([server.js](server.js)) - Express-based proxy server
   - Extracts Instagram Reels metadata using Cheerio
   - Generates HTML pages with Open Graph tags for social media previews
   - In-memory caching with 5-minute TTL
   - Main endpoint: `/tg/:reelId` for Telegram-optimized pages

2. **Telegram Bot** ([bot.js](bot.js)) - Automated link converter
   - Detects Instagram links in chat messages
   - Downloads videos using yt-dlp
   - Uses SQLite for caching Telegram file_id to avoid re-downloading
   - Works in fallback mode if yt-dlp is unavailable (cache-only)

3. **Database Module** ([database.js](database.js))
   - SQLite wrapper for bot's file_id caching
   - Single table: `cache (reel_id TEXT PRIMARY KEY, file_id TEXT)`

## Development Commands

```bash
# Install dependencies
npm install

# Run web server (development with auto-reload)
npm run dev

# Run web server (production)
npm start

# Run Telegram bot (development)
npm run bot:dev

# Run Telegram bot (production)
npm run bot
```

## Docker Commands

```bash
# Run bot only
docker-compose up instagram-reels-bot

# Run with custom compose file
docker-compose -f docker-compose.yml up

# Build and run from Dockerfile
docker build -t instagram-reels-bot .
docker run -e BOT_TOKEN=your_token -p 3666:3666 instagram-reels-bot
```

## Environment Variables

- `BOT_TOKEN` - Telegram bot token (required for bot)
- `GEMINI_API_KEY` - Google Gemini API key for AI caption generation (optional, 1500 free requests/day)
- `PORT` - Server port (default: 3666)
- `NODE_ENV` - Environment (production/development)

## Key Technical Details

- **Reel ID Extraction**: Both services use regex to extract reel IDs from Instagram URLs (`/reel/:id` or `/p/:id`)
- **Video Downloading**: Bot uses yt-dlp with format `best[ext=mp4]/best`
- **AI Caption Generation**:
  - Uses Google Gemini Flash 1.5 model
  - Extracts first frame with ffmpeg (`-vframes 1`)
  - Generates 2-3 word description
  - Falls back to no caption if Gemini unavailable
- **Caching Strategy**:
  - Server: In-memory Map with timestamp-based expiration
  - Bot: SQLite database with reel_id → file_id mapping
- **User-Agent Spoofing**: Server mimics Chrome browser to bypass Instagram restrictions
- **Docker Setup**: Alpine-based image with Node.js 18, Python 3, ffmpeg, and yt-dlp pre-installed

## Important Notes

- The bot requires yt-dlp to be installed (`pip install yt-dlp` or use Docker)
- Without yt-dlp, bot runs in fallback mode (cache-only)
- Server uses 10-second timeout for Instagram requests
- Downloaded videos are temporarily stored in OS temp directory and cleaned up after sending
- Database file `reels_cache.db` is created automatically in project root
- Server listens on port 3666 by default
