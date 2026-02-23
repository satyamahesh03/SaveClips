import { useState } from 'react';
import {
    HiFilm,
    HiMusicalNote,
    HiArrowDownTray,
} from 'react-icons/hi2';
import { BsFileEarmarkMusic, BsFiletypeMp4 } from 'react-icons/bs';
import '../styles/DownloadSection.css';

// const API_URL = 'http://localhost:6500';
const API_URL = 'https://saveclips.onrender.com';


export default function DownloadSection({ videoData, url }) {
    const [activeTab, setActiveTab] = useState('video');
    const [downloading, setDownloading] = useState(false);

    if (!videoData) return null;

    const { videoFormats, audioFormats, title, durationSeconds } = videoData;

    const getQualityClass = (quality) => {
        if (!quality) return '';
        const q = quality.toLowerCase();
        if (q.includes('4320') || q.includes('2160') || q.includes('1440')) return 'uhd';
        if (q.includes('1080') || q.includes('720')) return 'hd';
        return '';
    };

    const formatCodec = (codec) => {
        if (!codec) return '';
        const c = codec.toLowerCase();
        if (c.includes('av01') || c.includes('av1')) return 'AV1';
        if (c.includes('vp9') || c.includes('vp09')) return 'VP9';
        if (c.includes('vp8')) return 'VP8';
        if (c.includes('avc1') || c.includes('h264') || c.includes('h.264')) return 'H264';
        if (c.includes('hev') || c.includes('h265') || c.includes('h.265') || c.includes('hevc')) return 'H265';
        if (c.includes('opus')) return 'Opus';
        if (c.includes('mp4a') || c.includes('aac')) return 'AAC';
        if (c.includes('vorbis')) return 'Vorbis';
        if (c.includes('flac')) return 'FLAC';
        if (c.includes('mp3')) return 'MP3';
        return codec.split('.')[0].toUpperCase();
    };

    // Estimate MP3 file size: (bitrate in kbps * duration in seconds) / 8 / 1024 = MB
    const estimateAudioSize = (bitrate) => {
        if (!durationSeconds) return 'Unknown';
        const bytes = (bitrate * 1000 * durationSeconds) / 8;
        if (bytes >= 1073741824) return `~${(bytes / 1073741824).toFixed(1)} GB`;
        if (bytes >= 1048576) return `~${(bytes / 1048576).toFixed(1)} MB`;
        if (bytes >= 1024) return `~${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes} B`;
    };

    const triggerDownload = (downloadUrl) => {
        setDownloading(true);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.setAttribute('download', '');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Re-enable buttons after a short delay (download has been triggered)
        setTimeout(() => setDownloading(false), 3000);
    };

    const handleVideoDownload = (fmt) => {
        const downloadUrl = `${API_URL}/api/download?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&type=${fmt.type}&quality=${fmt.height}&formatId=${encodeURIComponent(fmt.formatId || '')}`;
        triggerDownload(downloadUrl);
    };

    const handleAudioDownload = (fmt) => {
        const downloadUrl = `${API_URL}/api/download?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&type=mp3&bitrate=${fmt.bitrate}`;
        triggerDownload(downloadUrl);
    };

    return (
        <div className="tabs-section" id="download-section">
            {/* Tabs */}
            <div className="tabs-header" id="tabs-header">
                <button
                    className={`tab-btn ${activeTab === 'video' ? 'active' : ''}`}
                    onClick={() => setActiveTab('video')}
                    id="video-tab-btn"
                >
                    <HiFilm className="tab-icon" />
                    Video
                    <span className="tab-count">{videoFormats.length}</span>
                </button>
                <button
                    className={`tab-btn ${activeTab === 'audio' ? 'active audio-tab' : ''}`}
                    onClick={() => setActiveTab('audio')}
                    id="audio-tab-btn"
                >
                    <HiMusicalNote className="tab-icon" />
                    Audio
                    <span className="tab-count">{audioFormats.length}</span>
                </button>
            </div>

            {/* Downloading banner */}
            {downloading && (
                <div className="downloading-banner" id="downloading-banner">
                    <div className="spinner-small"></div>
                    <span>Preparing your download...</span>
                </div>
            )}

            {/* Video Formats */}
            {activeTab === 'video' && (
                <div className="formats-list" id="video-formats-list">
                    {videoFormats.length > 0 ? (
                        videoFormats.map((fmt, i) => (
                            <div className={`format-card ${downloading ? 'disabled' : ''}`} key={`v-${fmt.height}-${i}`}>
                                <div className="format-left">
                                    <div className={`format-quality-badge ${getQualityClass(fmt.quality)}`}>
                                        {fmt.quality}
                                    </div>
                                    <div className="format-details">
                                        <span className="format-type">
                                            <BsFiletypeMp4 style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            {fmt.container?.toUpperCase()}
                                        </span>
                                        <div className="format-meta">
                                            <span>{formatCodec(fmt.codec)}</span>
                                            <span>🔊 Audio Included</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="format-right">
                                    <span className="format-size">{fmt.size}</span>
                                    <button
                                        className="download-btn"
                                        onClick={() => handleVideoDownload(fmt)}
                                        disabled={downloading}
                                        id={`download-video-${fmt.height}`}
                                    >
                                        <HiArrowDownTray className="btn-icon" />
                                        {downloading ? 'Wait...' : 'Download'}
                                    </button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="empty-formats">
                            <div className="empty-icon">🎬</div>
                            <p>No video formats available for this video.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Audio Formats */}
            {activeTab === 'audio' && (
                <div className="formats-list" id="audio-formats-list">
                    {audioFormats.length > 0 ? (
                        audioFormats.map((fmt, i) => (
                            <div className={`format-card audio-card ${downloading ? 'disabled' : ''}`} key={`a-${fmt.bitrate}-${i}`}>
                                <div className="format-left">
                                    <div className="format-quality-badge">
                                        {fmt.quality}
                                    </div>
                                    <div className="format-details">
                                        <span className="format-type">
                                            <BsFileEarmarkMusic style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            {fmt.label}
                                        </span>
                                        <div className="format-meta">
                                            <span>🎵 MP3 Format</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="format-right">
                                    <span className="format-size">{estimateAudioSize(fmt.bitrate)}</span>
                                    <button
                                        className="download-btn"
                                        onClick={() => handleAudioDownload(fmt)}
                                        disabled={downloading}
                                        id={`download-audio-${fmt.bitrate}`}
                                    >
                                        <HiArrowDownTray className="btn-icon" />
                                        {downloading ? 'Wait...' : 'Download'}
                                    </button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="empty-formats">
                            <div className="empty-icon">🎵</div>
                            <p>No audio formats available for this video.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
