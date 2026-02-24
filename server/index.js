const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const ytDlpPath = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp');
const cookiesPath = path.join(__dirname, 'cookies.txt');

// Cookie strategy: prefer cookies.txt, then try browser cookies (local dev)
const hasCookiesFile = () => fs.existsSync(cookiesPath);
const BROWSER_COOKIES = process.env.COOKIES_BROWSER || 'chrome'; // chrome, firefox, safari, edge
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

// Health Check
app.get('/', (req, res) => {
    res.status(200).send('SaveClip API Backend Running');
});

// Validate YouTube URL
function isValidYouTubeUrl(url) {
    const regex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]{11}/;
    return regex.test(url);
}

// Extract video ID
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

// ─── Helper: run yt-dlp --dump-json ────────────────────────────────────────────
function addCookieArgs(args) {
    if (hasCookiesFile()) {
        args.push('--cookies', cookiesPath);
    } else {
        // Use browser cookies for local development
        args.push('--cookies-from-browser', BROWSER_COOKIES);
    }
}

function ytDlpGetInfo(videoUrl) {
    return new Promise((resolve, reject) => {
        const args = [
            ytDlpPath, videoUrl,
            '--dump-json', '--no-download', '--no-warnings', '--no-playlist',
        ];
        addCookieArgs(args);

        const proc = spawn('python3', args, { windowsHide: true });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => (stdout += d.toString()));
        proc.stderr.on('data', (d) => (stderr += d.toString()));

        proc.on('close', (code) => {
            if (code !== 0) return reject(new Error(stderr.trim()));
            try { resolve(JSON.parse(stdout)); }
            catch { reject(new Error('Failed to parse yt-dlp output')); }
        });
        proc.on('error', reject);
    });
}

// ─── GET VIDEO INFO ────────────────────────────────────────────────────────────
// Strategy: try yt-dlp --dump-json first (gives full data + formats).
// Fallback: YouTube oEmbed API (never fails, but no formats/duration).
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

        let title, author, duration, viewCount, thumbnail, videoFormats;

        try {
            // Primary: yt-dlp --dump-json (works locally + on Render with cookies)
            const info = await ytDlpGetInfo(videoUrl);

            title = info.title || 'Unknown';
            author = info.uploader || info.channel || 'Unknown';
            duration = info.duration || 0;
            viewCount = info.view_count || 0;
            thumbnail = info.thumbnail
                || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

            // Extract actual video formats from yt-dlp
            const allFormats = info.formats || [];
            videoFormats = allFormats
                .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
                .map(f => ({
                    formatId: String(f.format_id),
                    quality: `${f.height}p`,
                    height: f.height || 0,
                    container: f.ext || 'mp4',
                    codec: f.vcodec ? f.vcodec.split('.')[0].toUpperCase() : 'UNKNOWN',
                    size: (f.filesize || f.filesize_approx)
                        ? formatBytes(f.filesize || f.filesize_approx)
                        : 'Unknown',
                    hasAudio: !!(f.acodec && f.acodec !== 'none'),
                    type: (f.acodec && f.acodec !== 'none') ? 'video+audio' : 'video-only',
                    fps: f.fps || 30,
                }));

            // Sort & deduplicate
            videoFormats.sort((a, b) => b.height - a.height);
            const seen = new Set();
            videoFormats = videoFormats.filter(f => {
                if (seen.has(f.quality)) return false;
                seen.add(f.quality);
                return true;
            });

            console.log(`[yt-dlp] Fetched: "${title}" — ${videoFormats.length} formats`);

        } catch (ytdlpError) {
            console.warn('[yt-dlp] Failed, falling back to oEmbed:', ytdlpError.message?.substring(0, 100));

            // Fallback: YouTube oEmbed (always works, never blocked)
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
            const resp = await fetch(oembedUrl);
            if (!resp.ok) throw new Error('oEmbed request failed');
            const oembed = await resp.json();

            title = oembed.title || 'Unknown';
            author = oembed.author_name || 'Unknown';
            duration = 0; // oEmbed doesn't provide duration
            viewCount = 0;
            thumbnail = oembed.thumbnail_url?.replace('hqdefault', 'maxresdefault')
                || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

            // Standard quality tiers (yt-dlp will pick the right one during download)
            videoFormats = [
                { formatId: '', quality: '2160p', height: 2160, container: 'mp4', codec: 'VP9', size: 'Unknown', hasAudio: false, type: 'video-only', fps: 30 },
                { formatId: '', quality: '1440p', height: 1440, container: 'mp4', codec: 'VP9', size: 'Unknown', hasAudio: false, type: 'video-only', fps: 30 },
                { formatId: '', quality: '1080p', height: 1080, container: 'mp4', codec: 'AVC1', size: 'Unknown', hasAudio: false, type: 'video-only', fps: 30 },
                { formatId: '', quality: '720p', height: 720, container: 'mp4', codec: 'AVC1', size: 'Unknown', hasAudio: false, type: 'video-only', fps: 30 },
                { formatId: '', quality: '480p', height: 480, container: 'mp4', codec: 'AVC1', size: 'Unknown', hasAudio: false, type: 'video-only', fps: 30 },
                { formatId: '', quality: '360p', height: 360, container: 'mp4', codec: 'AVC1', size: 'Unknown', hasAudio: true, type: 'video+audio', fps: 30 },
            ];

            console.log(`[oEmbed] Fetched: "${title}" — using standard quality tiers`);
        }

        const audioFormats = [
            { quality: '320kbps', bitrate: 320, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 320kbps (Best)' },
            { quality: '256kbps', bitrate: 256, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 256kbps (High)' },
            { quality: '192kbps', bitrate: 192, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 192kbps (Standard)' },
            { quality: '128kbps', bitrate: 128, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 128kbps (Normal)' },
        ];

        res.json({
            title,
            thumbnail,
            duration: formatDuration(duration),
            durationSeconds: duration,
            author,
            views: formatViews(viewCount),
            videoFormats,
            audioFormats,
        });
    } catch (error) {
        console.error('Error fetching video info:', error.message || error);
        res.status(500).json({ error: 'Failed to fetch video info. Please try again.' });
    }
});

// ─── DOWNLOAD (uses yt-dlp) ────────────────────────────────────────────────────
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

        const ytDlpArgs = [
            ytDlpPath, url,
            '--ffmpeg-location', ffmpegPath,
            '-o', tmpFile,
            '--no-warnings',
        ];

        addCookieArgs(ytDlpArgs);

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
                const h = quality ? parseInt(quality) : 1080;
                ytDlpArgs.push(
                    '-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
                    '--merge-output-format', 'mp4'
                );
            }
        }

        console.log(`[DL] Starting: ${filename}`);
        const ytdlpProcess = spawn('python3', ytDlpArgs, { windowsHide: true });

        let stderrLog = '';
        ytdlpProcess.stderr.on('data', (d) => { stderrLog += d.toString(); });

        ytdlpProcess.on('close', (code) => {
            console.log(`[DL] yt-dlp exited: ${code}`);

            if (code !== 0 || !fs.existsSync(tmpFile)) {
                console.error('[DL] Error:', stderrLog.substring(0, 300));
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
                if (!res.headersSent) {
                    res.status(500).json({
                        error: stderrLog.includes('Sign in')
                            ? 'YouTube requires cookies for this server. Ask the admin to add cookies.txt.'
                            : 'Download failed. Please try again.'
                    });
                }
                return;
            }

            const stat = fs.statSync(tmpFile);
            res.header('Content-Disposition', `attachment; filename="${filename}"`);
            res.header('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'video/mp4');
            res.header('Content-Length', stat.size);

            const fileStream = fs.createReadStream(tmpFile);
            fileStream.on('close', () => fs.unlink(tmpFile, () => { }));
            fileStream.on('error', (err) => {
                console.error('[DL] Stream error:', err.message);
                fs.unlink(tmpFile, () => { });
                if (!res.writableEnded) res.end();
            });
            fileStream.pipe(res);
        });

        ytdlpProcess.on('error', (err) => {
            console.error('[DL] Spawn error:', err.message);
            if (!res.headersSent) res.status(500).json({ error: 'Failed to start download' });
        });

    } catch (error) {
        console.error('Download error:', error.message);
        if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
        else res.end();
    }
});

// ─── HELPERS ───────────────────────────────────────────────────────────────────
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
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
    if (hasCookiesFile()) {
        console.log('✓ cookies.txt found — YouTube authentication enabled');
    } else {
        console.log(`✓ No cookies.txt — using browser cookies from: ${BROWSER_COOKIES}`);
        console.log('  (Set COOKIES_BROWSER env var to change: chrome, firefox, safari, edge)');
    }
});
