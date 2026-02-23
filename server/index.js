const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;
const { spawn } = require('child_process');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 6500;

// Resolve yt-dlp binary path dynamically
let ytDlpBinaryPath = os.platform() === 'win32'
    ? path.join(__dirname, 'yt-dlp.exe')
    : path.join(__dirname, 'yt-dlp');

// Note: Ensure yt-dlp executable exists natively for production
if (process.env.YT_DLP_PATH || fs.existsSync('/usr/bin/yt-dlp')) {
    ytDlpBinaryPath = process.env.YT_DLP_PATH || '/usr/bin/yt-dlp';
}

let ytDlp = new YTDlpWrap(ytDlpBinaryPath);

// Download yt-dlp dynamically if missing
(async () => {
    try {
        if (!fs.existsSync(ytDlpBinaryPath)) {
            console.log('Deploy phase: Downloading latest yt-dlp binary for hosting platform...');
            await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
            if (os.platform() !== 'win32') fs.chmodSync(ytDlpBinaryPath, '755');
            console.log('yt-dlp downloaded completely!');
        }
        ytDlp = new YTDlpWrap(ytDlpBinaryPath);
    } catch (err) {
        console.error('Failed to initialize yt-dlp:', err);
    }
})();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Validate YouTube URL
function isValidYouTubeUrl(url) {
    const regex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]{11}/;
    return regex.test(url);
}

// Get video info
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Use yt-dlp to get video info as JSON
        const info = await ytDlp.execPromise([
            url,
            '--dump-json',
            '--no-warnings',
            '--no-download',
        ]);

        const videoData = JSON.parse(info);

        // Extract video formats
        const formats = videoData.formats || [];

        // Get video formats (with or without audio)
        const videoFormats = formats
            .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
            .map(f => {
                let sizeBytes = f.filesize || f.filesize_approx || 0;

                // Fallback for newly uploaded videos or dynamic m3u8 streams lacking fixed file sizes
                if (!sizeBytes && (f.tbr || f.vbr) && videoData.duration) {
                    const bitrateKbps = f.tbr || f.vbr;
                    sizeBytes = (bitrateKbps * 1024 / 8) * videoData.duration;
                }

                // Standardize quality display to handle ultra-wide movies (e.g., 2026p implies 4K/2160p class)
                let qualityLabel = `${f.height}p`;
                if (f.format_note && f.format_note.match(/^\d+p\d*$/i)) {
                    qualityLabel = f.format_note; // Use yt-dlp's native label if available (e.g. "1080p")
                } else if (f.height) {
                    const h = f.height;
                    // General classification based on height ranges for non-standard aspect ratios
                    if (h >= 2000) qualityLabel = '2160p';
                    else if (h >= 1300) qualityLabel = '1440p';
                    else if (h >= 1000) qualityLabel = '1080p';
                    else if (h >= 700) qualityLabel = '720p';
                    else if (h >= 450) qualityLabel = '480p';
                    else if (h >= 340) qualityLabel = '360p';
                    else if (h >= 220) qualityLabel = '240p';
                    else if (h >= 130) qualityLabel = '144p';
                }

                return {
                    formatId: f.format_id,
                    quality: qualityLabel,
                    height: f.height || 0,
                    container: 'mp4',
                    codec: formatCodecName(f.vcodec),
                    size: sizeBytes ? formatBytes(sizeBytes) : 'Unknown',
                    hasAudio: f.acodec && f.acodec !== 'none',
                    type: (f.acodec && f.acodec !== 'none') ? 'video+audio' : 'video-only',
                    fps: f.fps || 30,
                };
            });

        // Sort by quality (highest first) and deduplicate
        // Use the raw height integer for accurate sorting, not the string label
        videoFormats.sort((a, b) => b.height - a.height);

        const seenQualities = new Set();
        const uniqueVideoFormats = [];
        for (const fmt of videoFormats) {
            if (!seenQualities.has(fmt.quality)) {
                seenQualities.add(fmt.quality);
                uniqueVideoFormats.push(fmt);
            }
        }

        // Predefined MP3 quality options
        const audioFormats = [
            { quality: '320kbps', bitrate: 320, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 320kbps (Best)' },
            { quality: '256kbps', bitrate: 256, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 256kbps (High)' },
            { quality: '192kbps', bitrate: 192, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 192kbps (Standard)' },
            { quality: '128kbps', bitrate: 128, container: 'MP3', codec: 'MP3', type: 'mp3', label: 'MP3 - 128kbps (Normal)' },
        ];

        // Get best thumbnail
        const thumbnails = videoData.thumbnails || [];
        const bestThumb = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : '';

        console.log(`Fetched: "${videoData.title}" — Duration: ${videoData.duration}s — Qualities: ${uniqueVideoFormats.map(f => f.quality).join(', ')}`);

        res.json({
            title: videoData.title || 'Unknown',
            thumbnail: bestThumb,
            duration: formatDuration(videoData.duration || 0),
            durationSeconds: videoData.duration || 0,
            author: videoData.uploader || videoData.channel || 'Unknown',
            views: formatViews(videoData.view_count || 0),
            videoFormats: uniqueVideoFormats,
            audioFormats,
        });
    } catch (error) {
        console.error('Error fetching video info:', error.message || error);
        res.status(500).json({ error: 'Failed to fetch video info. Please check the URL and try again.' });
    }
});

// Download video
app.get('/api/download', async (req, res) => {
    try {
        const { url, title, type, bitrate, quality } = req.query;

        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const sanitizedTitle = (title || 'video').replace(/[^\w\s-]/g, '').trim();

        const crypto = require('crypto');
        const tmpId = crypto.randomBytes(8).toString('hex');
        const ext = type === 'mp3' ? 'mp3' : 'mp4';
        const tmpFile = path.join(os.tmpdir(), `saveclip-${tmpId}.${ext}`);

        const filename = `${sanitizedTitle}.${ext}`;
        res.header('Content-Disposition', `attachment; filename="${filename}"`);
        res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
        res.flushHeaders(); // Tell browser download is starting immediately

        const spawnArgs = [];

        if (type === 'mp3') {
            spawnArgs.push(
                url,
                '-f', 'bestaudio',
                '-x', // extract audio
                '--audio-format', 'mp3',
                '--audio-quality', `${bitrate ? Math.round(bitrate) : 192}K`,
                '--ffmpeg-location', ffmpegPath,
                '-o', tmpFile,
                '--no-warnings',
                '--quiet',
                '--no-part'
            );
        } else {
            const formatStr = quality
                ? `bestvideo[height<=${parseInt(quality)}]+bestaudio/best[height<=${parseInt(quality)}]`
                : 'bestvideo+bestaudio/best';

            spawnArgs.push(
                url,
                '-f', formatStr,
                '--merge-output-format', 'mp4',
                '--ffmpeg-location', ffmpegPath,
                '-o', tmpFile,
                '--no-warnings',
                '--quiet',
                '--no-part'
            );
        }

        // Use yt-dlp to download and convert to the temporary file as fast as possible (avoids YT throttling)
        const ytdlpProcess = spawn(ytDlpBinaryPath, spawnArgs);

        ytdlpProcess.stderr.on('data', (data) => {
            console.error('yt-dlp stderr:', data.toString());
        });

        ytdlpProcess.on('close', (code) => {
            if (code !== 0 || !fs.existsSync(tmpFile)) {
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
                if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
                else res.end();
                return;
            }

            // Stream the fast-downloaded completed file back to Chrome progressively
            const stat = fs.statSync(tmpFile);
            const fileStream = fs.createReadStream(tmpFile);

            // Artificial loopback pacing so localhost Chrome doesn't jump 0->100% instantly
            // On production networks, this stream flows naturally at the user's ISP speed

            fileStream.on('data', chunk => {
                fileStream.pause();
                res.write(chunk);
                // ~5-10ms delay between 64kb chunks (~10-20 MB/s speed)
                setTimeout(() => fileStream.resume(), 10);
            });

            fileStream.on('end', () => {
                res.end();
                fs.unlink(tmpFile, () => { });
            });

            fileStream.on('error', (err) => {
                console.error('File stream error:', err.message);
                fs.unlink(tmpFile, () => { });
                if (!res.headersSent) res.status(500).json({ error: 'Download stream failed' });
                else res.end();
            });
        });

        ytdlpProcess.on('error', (err) => {
            console.error('yt-dlp error:', err.message);
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
            if (!res.headersSent) res.status(500).json({ error: 'Download process crashed' });
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
function formatCodecName(codec) {
    if (!codec || codec === 'none') return '';
    const c = codec.toLowerCase();
    if (c.includes('av01') || c.includes('av1')) return 'AV1';
    if (c.includes('vp9') || c.includes('vp09')) return 'VP9';
    if (c.includes('vp8')) return 'VP8';
    if (c.includes('avc1') || c.includes('h264') || c.includes('h.264')) return 'H264';
    if (c.includes('hev') || c.includes('h265') || c.includes('hevc')) return 'H265';
    return codec.split('.')[0].toUpperCase();
}

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
