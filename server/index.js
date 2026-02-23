const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
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

/**
 * Helper: run yt-dlp --dump-json to get video metadata.
 * Returns a Promise that resolves with the parsed JSON object.
 */
function getVideoInfoViYtDlp(videoUrl) {
    return new Promise((resolve, reject) => {
        const args = [
            ytDlpPath,
            videoUrl,
            '--dump-json',
            '--no-warnings',
            '--no-playlist',
        ];

        const proc = spawn('python3', args, { windowsHide: true });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => (stdout += d.toString()));
        proc.stderr.on('data', (d) => (stderr += d.toString()));

        proc.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error('Failed to parse yt-dlp JSON output'));
            }
        });

        proc.on('error', (err) => reject(err));
    });
}

// Get video info using yt-dlp (replaces play-dl to avoid 429 errors on cloud hosts)
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await getVideoInfoViYtDlp(url);

        // Extract video formats from yt-dlp output
        const allFormats = info.formats || [];

        const videoFormats = allFormats
            .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
            .map(f => {
                const sizeBytes = f.filesize || f.filesize_approx || 0;
                const qualityLabel = f.format_note || `${f.height}p`;

                return {
                    formatId: String(f.format_id),
                    quality: `${f.height}p`,
                    height: f.height || 0,
                    container: f.ext || 'mp4',
                    codec: f.vcodec ? f.vcodec.split('.')[0].toUpperCase() : 'UNKNOWN',
                    size: sizeBytes ? formatBytes(sizeBytes) : 'Unknown',
                    hasAudio: !!(f.acodec && f.acodec !== 'none'),
                    type: (f.acodec && f.acodec !== 'none') ? 'video+audio' : 'video-only',
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

        // Get best thumbnail
        const thumbnails = info.thumbnails || [];
        const bestThumb = thumbnails.length > 0
            ? thumbnails[thumbnails.length - 1].url
            : `https://img.youtube.com/vi/${info.id}/maxresdefault.jpg`;

        console.log(`Fetched: "${info.title}" — Qualities: ${uniqueVideoFormats.map(f => f.quality).join(', ')}`);

        res.json({
            title: info.title || 'Unknown',
            thumbnail: bestThumb,
            duration: formatDuration(info.duration || 0),
            durationSeconds: info.duration || 0,
            author: info.uploader || info.channel || 'Unknown',
            views: formatViews(info.view_count || 0),
            videoFormats: uniqueVideoFormats,
            audioFormats,
        });
    } catch (error) {
        console.error('Error fetching video info:', error.message || error);
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
