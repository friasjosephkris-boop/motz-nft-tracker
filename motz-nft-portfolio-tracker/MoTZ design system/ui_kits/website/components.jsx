// MoTZ website UI components — extracted from public/index.html
// Load order: React, ReactDOM, Babel, then this file, then index.html script

const Nav = () => (
  <nav className="nav">
    <div className="nav-logo">
      <img src="../../assets/logos/motz-wordmark-horizontal.png" alt="MoTZ" />
    </div>
    <div className="nav-links">
      <a href="#nfts">NFTs</a>
      <a href="#art">Art</a>
      <a href="#discord">Discord</a>
      <a href="#twitter">Twitter</a>
    </div>
  </nav>
);

const HeroBadge = ({ children }) => (
  <div className="hero-badge"><span className="dot"></span>{children}</div>
);

const Btn = ({ kind = 'primary', children, onClick }) => (
  <button className={`btn btn-${kind}`} onClick={onClick}>{children}</button>
);

const HubCard = ({ icon, tint, title, body, onClick }) => (
  <a className="hub-card" onClick={onClick} href="javascript:void(0)">
    <div className={`hub-card-icon ${tint}`}>{icon}</div>
    <span className="arrow">↗</span>
    <h3>{title}</h3>
    <p>{body}</p>
  </a>
);

const GameCard = ({ img, title, sub, tag, tagKind = 'active' }) => (
  <div className="game-card">
    {img ? <img src={img} alt={title} /> : <div className="emoji">🎮</div>}
    <h3>{title}</h3>
    <p>{sub}</p>
    <span className={`tag tag-${tagKind}`}>{tag}</span>
  </div>
);

const StatBlock = ({ label, value }) => (
  <div className="stat">
    <div className="stat-value">{value}</div>
    <div className="stat-label">{label}</div>
  </div>
);

const SectionTitle = ({ title, sub }) => (
  <div className="section-title"><h2>{title}</h2><p>{sub}</p></div>
);

const Footer = () => (
  <footer>
    <div className="footer-socials">
      <a href="#">𝕏</a><a href="#">💬</a><a href="#">🎮</a>
    </div>
    <div className="footer-text">Mark of The Zeal · made with <span className="heart">♥</span> by the squad</div>
  </footer>
);

// EgoFloat: the bobbing mascot reveal
const EgoFloat = ({ src = '../../assets/mascot/ego.png' }) => (
  <div className="ego-float"><img src={src} alt="Ego" /></div>
);

Object.assign(window, { Nav, HeroBadge, Btn, HubCard, GameCard, StatBlock, SectionTitle, Footer, EgoFloat });
