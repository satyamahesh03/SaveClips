import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './App.css';

// const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:6500';
// const API_URL = import.meta.env.VITE_API_URL || 'https://saveclips.onrender.com';
const API_URL = import.meta.env.VITE_API_URL || 'https://saveclipss.netlify.app';

const ASCII_LOGO = `
 ███████╗ █████╗ ██╗   ██╗███████╗ ██████╗██╗     ██╗██████╗ ███████╗
 ██╔════╝██╔══██╗██║   ██║██╔════╝██╔════╝██║     ██║██╔══██╗██╔════╝
 ███████╗███████║██║   ██║█████╗  ██║     ██║     ██║██████╔╝███████╗
 ╚════██║██╔══██║╚██╗ ██╔╝██╔══╝  ██║     ██║     ██║██╔═══╝ ╚════██║
 ███████║██║  ██║ ╚████╔╝ ███████╗╚██████╗███████╗██║██║     ███████║
 ╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝ ╚═════╝╚══════╝╚═╝╚═╝     ╚══════╝
`;

// Create a fresh session object
function createSession(urlValue = '', label = '') {
  return {
    id: Date.now() + Math.random(),
    url: urlValue,
    videoData: null,
    loading: false,
    error: '',
    activeTab: 'video',
    downloading: false,
    logs: [],
    label: label || (urlValue ? 'Loading...' : 'New Tab'),
    hadData: false, // tracks if this tab previously had fetched data
  };
}

// Save tabs to sessionStorage (cleared when tab/browser closes)
function saveTabs(sessions, activeIdx) {
  const toSave = sessions.map(s => ({
    url: s.url,
    label: s.label,
    hadData: !!(s.videoData || s.hadData),
  }));
  sessionStorage.setItem('saveclip_tabs', JSON.stringify(toSave));
  sessionStorage.setItem('saveclip_active', String(activeIdx));
}

// Load tabs from sessionStorage
function loadTabs() {
  try {
    const raw = sessionStorage.getItem('saveclip_tabs');
    const activeRaw = sessionStorage.getItem('saveclip_active');
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length > 0) {
        const sessions = saved.map(t => createSession(t.url || '', t.label || 'New Tab'));
        // Mark which tabs need auto-refetch
        sessions.forEach((s, i) => { s.hadData = saved[i].hadData || false; });
        const activeIdx = Math.min(parseInt(activeRaw) || 0, sessions.length - 1);
        return { sessions, activeIdx };
      }
    }
  } catch { }
  return null;
}

function App() {
  // Init: restore tabs from sessionStorage, or create from URL param
  const [sessions, setSessions] = useState(() => {
    const restored = loadTabs();
    if (restored) return restored.sessions;
    const initUrl = new URLSearchParams(window.location.search).get('url') || '';
    return [createSession(initUrl)];
  });

  const [activeSessionIdx, setActiveSessionIdx] = useState(() => {
    const restored = loadTabs();
    return restored ? restored.activeIdx : 0;
  });

  const inputRef = useRef(null);
  const hasAutoFetched = useRef(false);

  const session = sessions[activeSessionIdx];

  // Save to sessionStorage whenever sessions or active index change
  useEffect(() => {
    saveTabs(sessions, activeSessionIdx);
  }, [sessions, activeSessionIdx]);

  // Update a specific session field
  const updateSession = useCallback((idx, updates) => {
    setSessions(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  }, []);

  // Add log to a session
  const addLog = useCallback((idx, text, type = 'info') => {
    setSessions(prev => prev.map((s, i) =>
      i === idx ? { ...s, logs: [...s.logs, { text, type, id: Date.now() + Math.random() }] } : s
    ));
  }, []);

  // Set URL in browser address bar
  const setUrlParam = (urlValue) => {
    const params = new URLSearchParams();
    if (urlValue && urlValue.trim()) {
      params.set('url', urlValue.trim());
    }
    const search = params.toString();
    window.history.replaceState({}, '', search ? `${window.location.pathname}?${search}` : window.location.pathname);
  };

  // Fetch video info for a session
  const fetchVideoInfo = useCallback(async (idx, urlValue) => {
    if (!urlValue || !urlValue.trim()) return;

    updateSession(idx, { loading: true, error: '', videoData: null, logs: [] });
    addLog(idx, `$ saveclips --fetch "${urlValue.trim()}"`, 'cmd');

    setTimeout(() => addLog(idx, '[INFO] Connecting to YouTube servers...', 'info'), 200);
    setTimeout(() => addLog(idx, '[INFO] Extracting video metadata...', 'info'), 600);

    try {
      const response = await axios.post(`${API_URL}/api/info`, { url: urlValue.trim() });
      const data = response.data;
      const shortTitle = data.title?.length > 20 ? data.title.substring(0, 20) + '...' : data.title;

      updateSession(idx, {
        videoData: data,
        loading: false,
        label: shortTitle || 'Video',
        hadData: true,
      });
      addLog(idx, `[OK] Video found: "${data.title}"`, 'success');
      addLog(idx, `[OK] ${data.videoFormats.length} video formats available`, 'success');
      addLog(idx, `[OK] ${data.audioFormats.length} audio formats available`, 'success');
      addLog(idx, '[READY] Select a format to download ↓', 'success');
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to fetch video info.';
      updateSession(idx, { error: message, loading: false, label: 'Error' });
      addLog(idx, `[ERROR] ${message}`, 'error');
    }
  }, [updateSession, addLog]);

  // Auto-fetch on page load: refetch all tabs that previously had data
  useEffect(() => {
    if (hasAutoFetched.current) return;
    hasAutoFetched.current = true;

    sessions.forEach((s, idx) => {
      if (s.url && s.url.trim() && s.hadData) {
        fetchVideoInfo(idx, s.url);
      }
    });

    // Update address bar with active tab's URL
    if (session.url) setUrlParam(session.url);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input when switching tabs
  useEffect(() => {
    if (inputRef.current && !session.videoData && !session.loading) {
      inputRef.current.focus();
    }
  }, [activeSessionIdx, session.videoData, session.loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!session.url.trim()) return;
    // Put URL in address bar on Enter
    setUrlParam(session.url);
    fetchVideoInfo(activeSessionIdx, session.url);
  };

  const MAX_TABS = 6;

  const handleNewTab = () => {
    if (sessions.length >= MAX_TABS) return;
    const newSession = createSession();
    setSessions(prev => [...prev, newSession]);
    setActiveSessionIdx(sessions.length);
    // Clear URL from address bar for new tab
    setUrlParam('');
  };

  const handleSwitchTab = (idx) => {
    setActiveSessionIdx(idx);
    // Update address bar to this tab's URL
    setUrlParam(sessions[idx].url);
  };

  const handleCloseTab = (e, idx) => {
    e.stopPropagation();
    if (sessions.length <= 1) return; // Keep at least one tab
    const newSessions = sessions.filter((_, i) => i !== idx);
    setSessions(newSessions);
    const newIdx = idx >= newSessions.length ? newSessions.length - 1 : idx;
    setActiveSessionIdx(newIdx);
    setUrlParam(newSessions[newIdx].url);
  };

  // Helpers
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
    if (c.includes('avc1') || c.includes('h264')) return 'H.264';
    if (c.includes('hev') || c.includes('hevc')) return 'H.265';
    return codec.split('.')[0].toUpperCase();
  };

  const estimateAudioSize = (bitrate) => {
    const dur = session.videoData?.durationSeconds;
    if (!dur) return '—';
    const bytes = (bitrate * 1000 * dur) / 8;
    if (bytes >= 1073741824) return `~${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576) return `~${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `~${(bytes / 1024).toFixed(1)} KB`;
    return `~${Math.round(bytes)} B`;
  };

  const triggerDownload = (downloadUrl, label) => {
    updateSession(activeSessionIdx, { downloading: true });
    addLog(activeSessionIdx, `$ saveclips --download "${label}"`, 'cmd');
    addLog(activeSessionIdx, '[INFO] Preparing download...', 'info');

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.setAttribute('download', '');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      addLog(activeSessionIdx, '[OK] Download started! Check your browser downloads.', 'success');
      updateSession(activeSessionIdx, { downloading: false });
    }, 3000);
  };

  const handleVideoDownload = (fmt) => {
    const downloadUrl = `${API_URL}/api/download?url=${encodeURIComponent(session.url)}&title=${encodeURIComponent(session.videoData.title)}&type=${encodeURIComponent(fmt.type)}&quality=${fmt.height}&formatId=${encodeURIComponent(fmt.formatId || '')}`;
    triggerDownload(downloadUrl, `${fmt.quality} MP4`);
  };

  const handleAudioDownload = (fmt) => {
    const downloadUrl = `${API_URL}/api/download?url=${encodeURIComponent(session.url)}&title=${encodeURIComponent(session.videoData.title)}&type=mp3&bitrate=${fmt.bitrate}`;
    triggerDownload(downloadUrl, `MP3 ${fmt.quality}`);
  };

  return (
    <div className="terminal-window" id="terminal">
      {/* macOS Title Bar with Tabs */}
      <div className="terminal-titlebar">
        <div className="traffic-lights">
          <span className="traffic-dot red"></span>
          <span className="traffic-dot yellow"></span>
          <span className="traffic-dot green"></span>
        </div>

        <div className="session-tabs">
          {sessions.map((s, idx) => (
            <button
              key={s.id}
              className={`session-tab ${idx === activeSessionIdx ? 'active' : ''}`}
              onClick={() => handleSwitchTab(idx)}
            >
              <span className="session-tab-label">
                {s.loading ? '⠋' : s.videoData ? '▶' : '○'} {s.label}
              </span>
              {sessions.length > 1 && (
                <span className="session-tab-close" onClick={(e) => handleCloseTab(e, idx)}>×</span>
              )}
            </button>
          ))}
          {sessions.length < MAX_TABS && (
            <button className="session-tab new-tab" onClick={handleNewTab} title="New Tab">
              +
            </button>
          )}
        </div>
      </div>

      {/* Terminal Body */}
      <div className="terminal-body" id="terminal-body">
        {/* ASCII Art */}
        <pre className="ascii-art hacker-glow">{ASCII_LOGO}</pre>

        {/* Welcome Lines */}
        <div className="term-line delay-1">
          <span className="prompt">root@saveclips:~#</span> <span className="cmd typing-effect">./init_saveclips.sh</span>
        </div>
        <div className="term-line delay-3">
          <span className="info">[OK] Core modules loaded.</span>
        </div>
        <div className="term-line delay-4">
          <span className="info">[OK] YouTube mainframe connection established.</span>
        </div>
        <div className="term-line delay-5">
          <span className="success">✓ System ready. Awaiting target URL...</span>
        </div>

        <hr className="term-separator" />

        {/* Input */}
        <form onSubmit={handleSubmit}>
          <div className="term-input-line">
            <span className="prompt">saveclips $&nbsp;</span>
            <input
              ref={inputRef}
              type="text"
              className="term-input"
              id="url-input"
              placeholder="paste youtube url here..."
              value={session.url}
              onChange={(e) => updateSession(activeSessionIdx, { url: e.target.value })}
              disabled={session.loading}
              autoFocus
            />
          </div>
        </form>

        {/* Logs */}
        {session.logs.map((log) => (
          <div className="term-line" key={log.id}>
            <span className={log.type === 'cmd' ? 'cmd' : log.type === 'success' ? 'success' : log.type === 'error' ? 'error' : 'info'}>
              {log.text}
            </span>
          </div>
        ))}

        {/* Loading */}
        {session.loading && (
          <div className="term-loading">
            <div className="term-line">
              <span className="info">⠋ Processing<span className="term-loading-dots"></span></span>
            </div>
            <div className="term-progress">
              <div className="term-progress-bar">
                <div className="term-progress-fill"></div>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {session.error && (
          <div className="term-error">
            <span className="error">✖ {session.error}</span>
          </div>
        )}

        {/* Video Data */}
        {session.videoData && !session.loading && (
          <>
            <hr className="term-separator" />

            {/* Thumbnail */}
            <div className="term-thumbnail-wrap">
              <img
                className="term-thumbnail"
                src={session.videoData.thumbnail}
                alt={session.videoData.title}
              />
              <div className="term-thumbnail-overlay">
                ▶ {session.videoData.duration}
              </div>
            </div>

            {/* Video Info */}
            <div className="term-info-block">
              <div className="term-info-row">
                <span className="term-info-label">title:</span>
                <span className="term-info-value">{session.videoData.title}</span>
              </div>
              <div className="term-info-row">
                <span className="term-info-label">channel:</span>
                <span className="term-info-value">{session.videoData.author}</span>
              </div>
              <div className="term-info-row">
                <span className="term-info-label">duration:</span>
                <span className="term-info-value">{session.videoData.duration}</span>
              </div>
              <div className="term-info-row">
                <span className="term-info-label">views:</span>
                <span className="term-info-value">{session.videoData.views}</span>
              </div>
            </div>

            {/* Downloading Banner */}
            {session.downloading && (
              <div className="term-downloading">
                <span className="spinner-inline"></span>
                <span className="success">Preparing download... Please wait.</span>
              </div>
            )}

            {/* Format Tabs */}
            <div className="term-tabs">
              <button
                className={`term-tab ${session.activeTab === 'video' ? 'active' : ''}`}
                onClick={() => updateSession(activeSessionIdx, { activeTab: 'video' })}
                id="tab-video"
              >
                ▶ Video
                <span className="tab-count">{session.videoData.videoFormats.length}</span>
              </button>
              <button
                className={`term-tab ${session.activeTab === 'audio' ? 'audio-active' : ''}`}
                onClick={() => updateSession(activeSessionIdx, { activeTab: 'audio' })}
                id="tab-audio"
              >
                ♫ Audio
                <span className="tab-count">{session.videoData.audioFormats.length}</span>
              </button>
            </div>

            {/* Video Formats */}
            {session.activeTab === 'video' && (
              <div id="video-formats">
                {session.videoData.videoFormats.map((fmt, i) => (
                  <div
                    className={`format-row ${session.downloading ? 'disabled' : ''}`}
                    key={`v-${fmt.height}-${i}`}
                  >
                    <div className="format-left">
                      <span className={`quality-tag ${getQualityClass(fmt.quality)}`}>
                        {fmt.quality}
                      </span>
                      <div className="format-info">
                        <span className="format-name">MP4 · {formatCodec(fmt.codec)}</span>
                        <span className="format-detail">video+audio · {fmt.fps}fps</span>
                      </div>
                    </div>
                    <div className="format-right">
                      <span className="format-size">{fmt.size}</span>
                      <button
                        className="dl-btn"
                        onClick={() => handleVideoDownload(fmt)}
                        disabled={session.downloading}
                        id={`dl-v-${fmt.height}`}
                      >
                        {session.downloading ? '⏳ wait' : '↓ download'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Audio Formats */}
            {session.activeTab === 'audio' && (
              <div id="audio-formats">
                {session.videoData.audioFormats.map((fmt, i) => (
                  <div
                    className={`format-row audio-row ${session.downloading ? 'disabled' : ''}`}
                    key={`a-${fmt.bitrate}-${i}`}
                  >
                    <div className="format-left">
                      <span className="quality-tag audio">{fmt.quality}</span>
                      <div className="format-info">
                        <span className="format-name">{fmt.label}</span>
                        <span className="format-detail">audio · mp3</span>
                      </div>
                    </div>
                    <div className="format-right">
                      <span className="format-size">{estimateAudioSize(fmt.bitrate)}</span>
                      <button
                        className="dl-btn"
                        onClick={() => handleAudioDownload(fmt)}
                        disabled={session.downloading}
                        id={`dl-a-${fmt.bitrate}`}
                      >
                        {session.downloading ? '⏳ wait' : '↓ download'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="term-footer">
              <div className="term-line">
                <span className="dim">
                  # This tool is for personal use only. Respect copyright.
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
