import { HiUser, HiEye, HiClock } from 'react-icons/hi2';
import '../styles/VideoInfo.css';

export default function VideoInfoCard({ videoData }) {
    if (!videoData) return null;

    return (
        <div className="video-info-card" id="video-info-card">
            <div className="video-info-inner">
                <div className="video-thumbnail-wrapper">
                    <img
                        className="video-thumbnail"
                        src={videoData.thumbnail}
                        alt={videoData.title}
                        loading="lazy"
                    />
                    <span className="video-duration-badge">{videoData.duration}</span>
                </div>
                <div className="video-meta">
                    <h2 className="video-title" id="video-title">{videoData.title}</h2>
                    <div className="video-details">
                        <span className="video-detail-item">
                            <HiUser className="detail-icon" />
                            {videoData.author}
                        </span>
                        <span className="video-detail-item">
                            <HiEye className="detail-icon" />
                            {videoData.views}
                        </span>
                        <span className="video-detail-item">
                            <HiClock className="detail-icon" />
                            {videoData.duration}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
