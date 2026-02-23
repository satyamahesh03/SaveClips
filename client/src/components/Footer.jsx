import { HiPlay, HiBolt, HiShieldCheck } from 'react-icons/hi2';
import '../styles/Footer.css';

export default function Footer() {
    return (
        <>
            <section className="features" id="features-section">
                <div className="features-grid">
                    <div className="feature-card">
                        <span className="feature-icon"><HiBolt /></span>
                        <h3>Lightning Fast</h3>
                        <p>Direct downloads with no wait time or queues</p>
                    </div>
                    <div className="feature-card">
                        <span className="feature-icon">🎥</span>
                        <h3>All Qualities</h3>
                        <p>From 144p to 8K — every resolution available</p>
                    </div>
                    <div className="feature-card">
                        <span className="feature-icon"><HiShieldCheck /></span>
                        <h3>Safe & Private</h3>
                        <p>No data stored, no tracking, no sign-up needed</p>
                    </div>
                </div>
            </section>

            <footer className="footer" id="footer">
                <div className="footer-inner">
                    <div className="footer-brand">
                        <HiPlay className="footer-icon" />
                        <span>SaveClip</span>
                    </div>
                    <p>Download YouTube videos in any quality for free.</p>
                    <p className="disclaimer">
                        This tool is for personal use only. Respect copyright laws and content creators' rights.
                    </p>
                </div>
            </footer>
        </>
    );
}
