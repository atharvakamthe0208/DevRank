import { Link } from 'react-router-dom';

export function LandingPage() {
  return <main className="landing-page">
    <header className="landing-header">
      <Link to="/" className="brand" aria-label="DevRank home"><span className="brand-mark">d.</span><span>devrank<span className="brand-period">.</span></span></Link>
      <nav aria-label="Main navigation"><Link to="/login">Recruiter sign in</Link><Link className="primary-button" to="/dashboard">Open workspace <span>→</span></Link></nav>
    </header>
    <section className="landing-hero">
      <div className="landing-copy">
        <span className="landing-eyebrow"><span/> CANDIDATE INTELLIGENCE, MADE CLEAR</span>
        <h1>Hire with a clearer view of <span>potential.</span></h1>
        <p>Bring developer evidence into one thoughtful workspace. Compare candidates with confidence and make better informed hiring decisions.</p>
        <div className="landing-actions"><Link className="primary-button" to="/dashboard">Explore DevRank <span>→</span></Link><Link className="landing-secondary-link" to="/signup">Create a recruiter account</Link></div>
        <div className="landing-proof"><span>✦</span> Evidence-led insights <i/> Built for recruiter workflows</div>
      </div>
      <div className="landing-preview" aria-label="DevRank candidate evaluation preview">
        <div className="preview-topline"><span><i/> DEV RANK · WORKSPACE</span><span>Candidate overview</span></div>
        <div className="preview-heading"><div><small>RECENT EVALUATION</small><h2>Candidate insight</h2></div><span className="preview-pill">Ready to review</span></div>
        <div className="preview-candidate"><span className="preview-avatar">AM</span><span><strong>Alex Morgan</strong><small>Full-stack engineer · 3 profiles linked</small></span><b>↗</b></div>
        <div className="preview-score"><div><small>OVERALL MATCH</small><strong>92<span>/100</span></strong></div><div className="preview-meter"><i/></div><span>Strong alignment</span></div>
        <div className="preview-dimensions"><div><small>PROBLEM SOLVING</small><strong>Excellent</strong><i/></div><div><small>CODE QUALITY</small><strong>Strong</strong><i/></div><div><small>CONSISTENCY</small><strong>Strong</strong><i/></div></div>
        <div className="preview-foot"><span>✦ &nbsp; Grounded in candidate evidence</span><span>View evaluation →</span></div>
      </div>
    </section>
    <footer className="landing-footer"><span>© 2026 DevRank</span><span>Thoughtful hiring starts with better insight.</span></footer>
  </main>;
}
