const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ytdl = require('@distube/ytdl-core');

const ytDlpPath = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp');
const cookiesPath = path.join(__dirname, 'cookies.txt');
const app = express();
const PORT = process.env.PORT || 6500;

const allowedOrigins = [
    'https://save-clips-ten.vercel.app',
    'https://saveclips.satyapage.in',
    'http://localhost:5173',
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
}));
app.use(express.json());

// Health Check route
app.get('/', (req, res) => {
    res.status(200).send('SaveClip API Backend Running');
});

// Validate YouTube URL
function isValidYouTubeUrl(url) {
    const regex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]{11}/;
    return regex.test(url);
}

// Extract video ID from a YouTube URL
function extractVideoId(url) {
    const patterns = [
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /[?&]v=([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ─── GET VIDEO INFO (uses @distube/ytdl-core) ──────────────────────────────────
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'Could not extract video ID from URL' });
        }

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const info = await ytdl.getInfo(videoUrl);
        const details = info.videoDetails;

        // Extract video formats (with video track)
        const videoFormats = info.formats
            .filter(f => f.hasVideo && f.qualityLabel && f.height)
            .map(f => ({
                formatId: String(f.itag),
                quality: f.qualityLabel || `${f.height}p`,
                height: f.height || 0,
                container: f.container || 'mp4',
                codec: f.videoCodec ? f.videoCodec.split('.')[0].toUpperCase() : 'UNKNOWN',
                size: f.contentLength ? formatBytes(Number(f.contentLength)) : 'Unknown',
                hasAudio: f.hasAudio || false,
                type: f.hasAudio ? 'video+audio' : 'video-only',
                fps: f.fps || 30,
            }));

        // Sort by height descending and deduplicate
        videoFormats.sort((a, b) => b.height - a.height);
        const seenQualities = new Set();
        const uniqueVideoFormats = [];
        for (const fmt of videoFormats) {
            if (!seenQualities.has(fmt.quality)) {
                seenQualities.add(fmt.quality);
                uniqueVideoFormats.push(fmt);
            }
        }

        const audioFormats = [
            { quality: '320kbps', bitrate: 320, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 320kbps (Best)' },
            { quality: '256kbps', bitrate: 256, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 256kbps (High)' },
            { quality: '192kbps', bitrate: 192, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 192kbps (Standard)' },
            { quality: '128kbps', bitrate: 128, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 128kbps (Normal)' },
        ];

        // Thumbnail
        const thumbs = details.thumbnails || [];
        const bestThumb = thumbs.length > 0
            ? thumbs[thumbs.length - 1].url
            : `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

        console.log(`Fetched: "${details.title}" — Qualities: ${uniqueVideoFormats.map(f => f.quality).join(', ')}`);

        res.json({
            title: details.title || 'Unknown',
            thumbnail: bestThumb,
            duration: formatDuration(Number(details.lengthSeconds) || 0),
            durationSeconds: Number(details.lengthSeconds) || 0,
            author: details.author?.name || details.ownerChannelName || 'Unknown',
            views: formatViews(Number(details.viewCount) || 0),
            videoFormats: uniqueVideoFormats,
            audioFormats,
        });
    } catch (error) {
        console.error('Error fetching video info:', error.message || error);
        res.status(500).json({ error: 'Failed to fetch video info. Please try again.' });
    }
});

// ─── DOWNLOAD (uses yt-dlp — most reliable for actual downloading) ─────────────
app.get('/api/download', async (req, res) => {
    try {
        const { url, title, type, quality, bitrate, formatId } = req.query;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const sanitizedTitle = (title || 'video').replace(/[^\w\s-]/g, '').trim();
        const ext = type === 'mp3' ? 'mp3' : 'mp4';
        const filename = `${sanitizedTitle}.${ext}`;

        const crypto = require('crypto');
        const tmpId = crypto.randomBytes(8).toString('hex');
        const tmpFile = path.join(os.tmpdir(), `saveclip-${tmpId}.${ext}`);

        // Build yt-dlp arguments
        const ytDlpArgs = [
            ytDlpPath,
            url,
            '--ffmpeg-location', ffmpegPath,
            '-o', tmpFile,
            '--no-warnings',
        ];

        // Add cookies if the file exists (needed for Render / cloud servers)
        if (fs.existsSync(cookiesPath)) {
            ytDlpArgs.push('--cookies', cookiesPath);
            console.log('[DL] Using cookies.txt for authentication');
        }

        if (type === 'mp3') {
            ytDlpArgs.push(
                '-f', 'bestaudio',
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', `${bitrate ? Math.round(bitrate) : 192}K`
            );
        } else {
            if (formatId) {
                if (type === 'video+audio') {
                    ytDlpArgs.push('-f', `${formatId}`, '--merge-output-format', 'mp4');
                } else {
                    ytDlpArgs.push('-f', `${formatId}+bestaudio`, '--merge-output-format', 'mp4');
                }
            } else {
                const formatStr = quality
                    ? `bestvideo[height<=${parseInt(quality)}]+bestaudio/best[height<=${parseInt(quality)}]`
                    : 'bestvideo+bestaudio/best';
                ytDlpArgs.push('-f', formatStr, '--merge-output-format', 'mp4');
            }
        }

        console.log(`[DL] ${filename} — yt-dlp starting...`);
        const ytdlpProcess = spawn('python3', ytDlpArgs, { windowsHide: true });

        let stderrLog = '';
        ytdlpProcess.stderr.on('data', (data) => {
            stderrLog += data.toString();
        });

        ytdlpProcess.stdout.on('data', (data) => {
            // yt-dlp progress output
        });

        ytdlpProcess.on('close', (code) => {
            console.log(`[DL] yt-dlp exited with code: ${code}`);

            if (code !== 0 || !fs.existsSync(tmpFile)) {
                console.error('[DL] yt-dlp error:', stderrLog.substring(0, 500));
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
                if (!res.headersSent) {
                    res.status(500).json({
                        error: stderrLog.includes('Sign in')
                            ? 'YouTube requires authentication. Please add cookies.txt to the server.'
                            : 'Download failed. Please try again.'
                    });
                }
                return;
            }

            // Set headers and stream the file
            const stat = fs.statSync(tmpFile);
            res.header('Content-Disposition', `attachment; filename="${filename}"`);
            res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
            res.header('Content-Length', stat.size);

            const fileStream = fs.createReadStream(tmpFile);

            fileStream.on('error', (err) => {
                console.error('[DL] File stream error:', err.message);
                fs.unlink(tmpFile, () => { });
                if (!res.headersSent) res.status(500).json({ error: 'Download stream failed' });
                else res.end();
            });

            fileStream.on('close', () => {
                fs.unlink(tmpFile, () => { });
            });

            fileStream.pipe(res);
        });

        ytdlpProcess.on('error', (err) => {
            console.error('[DL] yt-dlp spawn error:', err.message);
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
            if (!res.headersSent) res.status(500).json({ error: 'Failed to start download process' });
        });

    } catch (error) {
        console.error('Download error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed. Please try again.' });
        } else {
            res.end();
        }
    }
});

// ─── HELPER FUNCTIONS ──────────────────────────────────────────────────────────
function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatViews(views) {
    if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B views`;
    if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
    if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K views`;
    return `${views} views`;
}

app.listen(PORT, () => {
    console.log(`SaveClip Server running on http://localhost:${PORT}`);
    if (fs.existsSync(cookiesPath)) {
        console.log('✓ cookies.txt found — YouTube authentication enabled');
    } else {
        console.log('⚠ No cookies.txt found — downloads may fail on cloud servers');
        console.log('  To fix: export YouTube cookies from your browser and save as cookies.txt');
    }
});
