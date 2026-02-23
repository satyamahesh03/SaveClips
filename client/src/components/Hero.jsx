import { HiMagnifyingGlass, HiArrowDownTray, HiExclamationCircle } from 'react-icons/hi2';
import '../styles/Hero.css';

export default function Hero({ url, setUrl, onFetch, loading, error }) {
    const handleSubmit = (e) => {
        e.preventDefault();
        onFetch();
    };

    return (
        <>
            <section className="hero" id="hero-section">
                <div className="hero-tag">
                    <span className="dot"></span>
                    Free YouTube Downloader
                </div>
                <h1>
                    Download YouTube Videos<br />
                    <span className="gradient-text">In Any Quality</span>
                </h1>
                <p>
                    Paste any YouTube link and download videos in resolutions from 144p to 8K,
                    or extract audio in multiple formats — all free, fast, and with no limits.
                </p>
            </section>

            <section className="search-section" id="search-section">
                <form onSubmit={handleSubmit}>
                    <div className="search-container" id="search-container">
                        <HiMagnifyingGlass className="search-icon" />
                        <input
                            type="url"
                            className="search-input"
                            id="youtube-url-input"
                            placeholder="Paste YouTube video link here..."
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            disabled={loading}
                            autoFocus
                        />
                        <button
                            type="submit"
                            className="search-btn"
                            id="fetch-btn"
                            disabled={loading || !url.trim()}
                        >
                            {loading ? (
                                <>
                                    <span className="spinner-small"></span>
                                    Fetching...
                                </>
                            ) : (
                                <>
                                    <HiArrowDownTray className="btn-icon" />
                                    Get Video
                                </>
                            )}
                        </button>
                    </div>
                </form>
                {error && (
                    <div className="search-error" id="error-message">
                        <HiExclamationCircle />
                        {error}
                    </div>
                )}
            </section>
        </>
    );
}
