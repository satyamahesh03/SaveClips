const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const ytDlpPath = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp');
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
        /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
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

// Lazy-initialized InnerTube instance (youtubei.js)
let _innertube = null;
async function getInnertube() {
    if (!_innertube) {
        // youtubei.js is ESM-only, so we use dynamic import
        const { Innertube } = await import('youtubei.js');
        _innertube = await Innertube.create({
            lang: 'en',
            location: 'US',
        });
    }
    return _innertube;
}

// Get video info using youtubei.js (YouTube's own InnerTube API — no bot detection)
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

        const yt = await getInnertube();
        const info = await yt.getInfo(videoId);

        // Debug: log available top-level keys
        console.log('[DEBUG] info keys:', Object.keys(info).filter(k => !k.startsWith('_')).join(', '));

        const details = info.basic_info || {};
        const streamingData = info.streaming_data;

        // Debug: log what we got
        console.log('[DEBUG] basic_info keys:', Object.keys(details).join(', '));
        console.log('[DEBUG] title:', details.title);
        console.log('[DEBUG] streaming_data exists:', !!streamingData);
        console.log('[DEBUG] formats count:', streamingData?.formats?.length || 0);
        console.log('[DEBUG] adaptive_formats count:', streamingData?.adaptive_formats?.length || 0);

        // Fallback title from primary_info or video_details
        const title = details.title
            || info.primary_info?.title?.text
            || info.video_details?.title
            || 'Unknown';

        const duration = details.duration
            || info.video_details?.length_seconds
            || 0;

        const author = details.author
            || details.channel?.name
            || info.video_details?.author
            || info.secondary_info?.owner?.author?.name
            || 'Unknown';

        const viewCount = details.view_count
            || info.video_details?.view_count
            || 0;

        // Extract video formats
        const allFormats = [
            ...(streamingData?.formats || []),
            ...(streamingData?.adaptive_formats || []),
        ];

        const videoFormats = allFormats
            .filter(f => f.has_video && f.height)
            .map(f => {
                let sizeBytes = 0;
                if (f.content_length) {
                    sizeBytes = Number(f.content_length);
                } else if (f.bitrate && duration) {
                    sizeBytes = Math.round((f.bitrate * duration) / 8);
                }

                return {
                    formatId: String(f.itag),
                    quality: `${f.height}p`,
                    height: f.height || 0,
                    container: f.mime_type?.split('/')[1]?.split(';')[0] || 'mp4',
                    codec: f.mime_type?.match(/codecs="([^"]+)"/)?.[1]?.split(',')[0]?.split('.')[0]?.toUpperCase() || 'UNKNOWN',
                    size: sizeBytes > 0 ? `~${formatBytes(sizeBytes)}` : 'Unknown',
                    hasAudio: f.has_audio || false,
                    type: f.has_audio ? 'video+audio' : 'video-only',
                    fps: f.fps || 30,
                };
            });

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

        // Best thumbnail — try multiple sources
        const thumbnails = details.thumbnail || [];
        const bestThumb = (thumbnails.length > 0 ? thumbnails[thumbnails.length - 1]?.url : null)
            || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

        console.log(`Fetched: "${title}" — Qualities: ${uniqueVideoFormats.map(f => f.quality).join(', ')}`);

        res.json({
            title,
            thumbnail: bestThumb,
            duration: formatDuration(duration),
            durationSeconds: duration,
            author,
            views: formatViews(viewCount),
            videoFormats: uniqueVideoFormats,
            audioFormats,
        });
    } catch (error) {
        console.error('Error fetching video info:', error.message || error);
        // Reset innertube instance on error so it gets re-created next time
        _innertube = null;
        res.status(500).json({ error: 'Failed to fetch video info. Please try again.' });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const { url, title, type, quality, bitrate, formatId } = req.query;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const sanitizedTitle = (title || 'video').replace(/[^\w\s-]/g, '').trim();
        const ext = type === 'mp3' ? 'mp3' : 'mp4';
        const filename = `${sanitizedTitle}.${ext}`;

        res.header('Content-Disposition', `attachment; filename="${filename}"`);
        res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
        res.flushHeaders(); // Tell browser download is starting immediately

        const crypto = require('crypto');
        const tmpId = crypto.randomBytes(8).toString('hex');
        const tmpFile = path.join(os.tmpdir(), `saveclip-${tmpId}.${ext}`);

        const ytDlpArgs = [
            ytDlpPath,
            url,
            '--ffmpeg-location', ffmpegPath,
            '-o', tmpFile,
            '--quiet', '--no-warnings'
        ];

        if (type === 'mp3') {
            ytDlpArgs.push(
                '-f', 'bestaudio',
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', `${bitrate ? Math.round(bitrate) : 192}K`
            );
        } else {
            /**
             * Prefer using the exact formatId selected on the frontend so that:
             * - The downloaded file matches the chosen quality/codec.
             * - The filesize is close to what was displayed.
             * Fallback to the previous "bestvideo<=height + bestaudio" selector
             * if formatId is not provided (for backwards compatibility).
             */
            if (formatId) {
                if (type === 'video+audio') {
                    // Format already has audio included
                    ytDlpArgs.push(
                        '-f', `${formatId}`,
                        '--merge-output-format', 'mp4'
                    );
                } else {
                    // Video-only format: combine with bestaudio
                    ytDlpArgs.push(
                        '-f', `${formatId}+bestaudio`,
                        '--merge-output-format', 'mp4'
                    );
                }
            } else {
                const formatStr = quality
                    ? `bestvideo[height<=${parseInt(quality)}]+bestaudio/best[height<=${parseInt(quality)}]`
                    : 'bestvideo+bestaudio/best';

                ytDlpArgs.push(
                    '-f', formatStr,
                    '--merge-output-format', 'mp4'
                );
            }
        }

        console.log("Spawning python3 with args:", ytDlpArgs.join(" "));
        const ytdlpProcess = spawn('python3', ytDlpArgs, { windowsHide: true });

        // We don't pipe stdout because it's not a stream anymore. Data is going to tmpFile.
        ytdlpProcess.stderr.on('data', (data) => {
            console.log("yt-dlp stderr:", data.toString());
        });

        ytdlpProcess.on('close', (code) => {
            console.log("yt-dlp exited with code:", code);
            if (code !== 0 || !fs.existsSync(tmpFile)) {
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
                if (!res.headersSent) res.status(500).json({ error: 'Download failed during decoding pipeline' });
                else res.end();
                return;
            }

            // Stream the completed file back to the client as fast as the connection allows.
            const fileStream = fs.createReadStream(tmpFile);

            fileStream.on('error', (err) => {
                console.error('File stream error:', err.message);
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
            console.error('yt-dlp spawn error (python3 missing?):', err.message);
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
            if (!res.headersSent) res.status(500).json({ error: 'Failed to start download process' });
            else res.end();
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

// Helper functions
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
});
