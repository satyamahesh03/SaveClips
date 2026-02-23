import { HiPlay } from 'react-icons/hi2';
import '../styles/Header.css';

export default function Header() {
    return (
        <header className="header" id="header">
            <div className="header-inner">
                <div className="logo" id="logo">
                    <div className="logo-icon">
                        <HiPlay />
                    </div>
                    <span className="logo-text">SaveClip</span>
                </div>
                <div className="header-badge">
                    <span>Free</span> • No Limits
                </div>
            </div>
        </header>
    );
}
