import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import devrankMark from '../../assets/devrank-mark.svg';
import { WorkspaceIcon } from '../../components/icons/WorkspaceIcon';
import './public-landing.css';

type PreviewTab = 'candidates' | 'evaluations' | 'insights';

const previewTabs: { id: PreviewTab; label: string }[] = [
  { id: 'candidates', label: 'Candidates' },
  { id: 'evaluations', label: 'Evaluations' },
  { id: 'insights', label: 'Insights' },
];

function ProductPreview({ activeTab }: { activeTab: PreviewTab }) {
  return (
    <div className="landing-product-window" aria-live="polite">
      <div className="landing-window-bar"><span className="landing-window-mark"><img src={devrankMark} alt="" /></span><strong>DevRank</strong><span className="landing-window-label">Illustrative preview · sample data</span></div>
      <div className="landing-window-body">
        <aside className="landing-preview-sidebar" aria-hidden="true"><span className="is-active"><WorkspaceIcon name="overview" size={17}/></span><span><WorkspaceIcon name="candidates" size={17}/></span><span><WorkspaceIcon name="evaluations" size={17}/></span><span><WorkspaceIcon name="insights" size={17}/></span></aside>
        <div className="landing-preview-content">
          {activeTab === 'candidates' && <>
            <div className="landing-preview-heading"><div><small>RECRUITER WORKSPACE</small><h3>Candidate overview</h3></div><span className="landing-preview-pill">Sample workspace</span></div>
            <div className="landing-preview-table" role="presentation">
              <div className="landing-preview-table-head"><span>Candidate</span><span>Profile evidence</span><span>Status</span></div>
              <div className="landing-preview-table-row"><span className="landing-sample-avatar">SC</span><strong>Sample candidate</strong><span>GitHub · LeetCode</span><span className="landing-status landing-status-ready">Ready to review</span></div>
              <div className="landing-preview-table-row"><span className="landing-sample-avatar landing-avatar-muted">AR</span><strong>Another example</strong><span>GitHub profile</span><span className="landing-status landing-status-partial">Partial evidence</span></div>
            </div>
            <p className="landing-preview-note">Missing information stays visible for recruiter review.</p>
          </>}
          {activeTab === 'evaluations' && <>
            <div className="landing-preview-heading"><div><small>STRUCTURED REVIEW</small><h3>Evaluation summary</h3></div><span className="landing-preview-pill">Example only</span></div>
            <div className="landing-preview-score"><div><span>Illustrative overall score</span><strong>78<span>/100</span></strong></div><div className="landing-score-ring" aria-label="Illustrative score: 78 out of 100"><span>78</span></div></div>
            <div className="landing-preview-categories"><div><span>Project portfolio</span><i><b style={{ width: '78%' }}/></i><strong>78</strong></div><div><span>Technical skills</span><i><b style={{ width: '70%' }}/></i><strong>70</strong></div><div><span>Development activity</span><i><b style={{ width: '84%' }}/></i><strong>84</strong></div></div>
            <p className="landing-preview-note">Illustrative values only. Actual results reflect available evidence and the active rubric.</p>
          </>}
          {activeTab === 'insights' && <>
            <div className="landing-preview-heading"><div><small>EVIDENCE-AWARE REVIEW</small><h3>Candidate insights</h3></div><span className="landing-preview-pill">Example only</span></div>
            <div className="landing-insight-row"><span className="landing-insight-icon"><WorkspaceIcon name="completed" size={17}/></span><div><strong>Evidence-grounded explanation</strong><p>When available, AI-assisted summaries connect back to saved evidence.</p></div></div>
            <div className="landing-insight-row"><span className="landing-insight-icon landing-insight-muted"><WorkspaceIcon name="screening" size={17}/></span><div><strong>Information gap</strong><p>Some categories may have limited or unavailable data.</p></div></div>
            <p className="landing-preview-note">Insights support recruiter judgment; they do not make hiring decisions.</p>
          </>}
        </div>
      </div>
    </div>
  );
}

export function PublicLandingPage() {
  const [activeTab, setActiveTab] = useState<PreviewTab>('candidates');
  const [menuOpen, setMenuOpen] = useState(false);
  const landingRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<PreviewTab, HTMLButtonElement | null>>({ candidates: null, evaluations: null, insights: null });
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    const landing = landingRef.current;
    if (!landing || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;

    const sections = Array.from(landing.querySelectorAll<HTMLElement>('[data-landing-reveal]'));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('landing-reveal-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });

    for (const section of sections) {
      section.classList.add('landing-reveal-ready');
      observer.observe(section);
    }

    return () => observer.disconnect();
  }, []);
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = previewTabs.findIndex((tab) => tab.id === activeTab);
    const nextIndex = event.key === 'ArrowRight' ? (currentIndex + 1) % previewTabs.length
      : event.key === 'ArrowLeft' ? (currentIndex - 1 + previewTabs.length) % previewTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? previewTabs.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = previewTabs[nextIndex];
    setActiveTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  return (
    <main className="public-landing" ref={landingRef}>
      <header className="landing-nav-wrap">
        <nav className="landing-nav" aria-label="Public navigation">
          <Link className="landing-brand" to="/" aria-label="DevRank home"><img src={devrankMark} alt=""/><span>devrank<span>.</span></span></Link>
          <button className={`landing-menu-toggle${menuOpen ? ' is-open' : ''}`} type="button" aria-expanded={menuOpen} aria-controls="landing-nav-links" onClick={() => setMenuOpen((open) => !open)}><span>{menuOpen ? 'Close' : 'Menu'}</span><span className="landing-menu-glyph" aria-hidden="true"><i/><i/><i/></span></button>
          <div className={`landing-nav-links${menuOpen ? ' is-open' : ''}`} id="landing-nav-links">
            <a href="#product" onClick={closeMenu}>Product</a><a href="#how-it-works" onClick={closeMenu}>How it works</a><a href="#recruiters" onClick={closeMenu}>For recruiters</a>
            <Link className="landing-sign-in" to="/login" onClick={closeMenu}>Sign in</Link><Link className="landing-request landing-request-nav" to="/signup" onClick={closeMenu}>Request access <span aria-hidden="true">↗</span></Link>
          </div>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow"><span/> A clearer view of developer talent</p>
            <h1 id="landing-title">Evaluate engineering talent with <em>greater clarity.</em></h1>
            <p className="landing-hero-description">Bring candidate profiles, developer evidence, structured evaluations, and actionable insights into one recruiter workspace.</p>
            <div className="landing-hero-actions"><Link to="/signup" className="landing-request">Request access <span aria-hidden="true">↗</span></Link><a className="landing-explore" href="#product"><span className="landing-play" aria-hidden="true">↓</span> Explore the platform</a></div>
            <p className="landing-trust"><span aria-hidden="true">◇</span> Decision support for recruiters. Human judgment stays at the center.</p>
          </div>
          <div className="landing-hero-visual">
            <div className="landing-visual-glow" aria-hidden="true"/><div className="landing-visual-orbit landing-orbit-one" aria-hidden="true"/><div className="landing-visual-orbit landing-orbit-two" aria-hidden="true"/>
            <div className="landing-preview-tabs" role="tablist" aria-label="Product preview">
              {previewTabs.map((tab) => <button key={tab.id} ref={(element) => { tabRefs.current[tab.id] = element; }} type="button" role="tab" tabIndex={activeTab === tab.id ? 0 : -1} aria-selected={activeTab === tab.id} aria-controls="landing-preview-panel" id={`landing-tab-${tab.id}`} onClick={() => setActiveTab(tab.id)} onKeyDown={handleTabKeyDown}>{tab.label}</button>)}
            </div>
            <div id="landing-preview-panel" role="tabpanel" aria-labelledby={`landing-tab-${activeTab}`}><ProductPreview key={activeTab} activeTab={activeTab}/></div>
            <span className="landing-visual-caption">A considered workflow, from profile to review.</span>
          </div>
        </div>
      </section>

      <section className="landing-proofline" aria-label="Platform approach"><div><span>01</span> Organized candidate context</div><i/><div><span>02</span> Structured evidence review</div><i/><div><span>03</span> Recruiter-led decisions</div></section>

      <section className="landing-workflow landing-section" id="how-it-works" data-landing-reveal>
        <div className="landing-section-intro"><p className="landing-section-kicker">A thoughtful workflow</p><h2>From scattered profiles to a clearer review.</h2><p>Keep the work connected, the evidence visible, and the decision with your team.</p></div>
        <div className="landing-steps">
          <article><span className="landing-step-number">01</span><span className="landing-step-icon"><WorkspaceIcon name="candidates" size={22}/></span><h3>Organize candidates</h3><p>Keep candidate profiles and relevant developer evidence together in one workspace.</p><span className="landing-step-link">Candidate management <span aria-hidden="true">→</span></span></article>
          <div className="landing-step-connector" aria-hidden="true"><span>→</span></div>
          <article><span className="landing-step-number">02</span><span className="landing-step-icon"><WorkspaceIcon name="evaluations" size={22}/></span><h3>Evaluate consistently</h3><p>Review structured evaluation results and category-level evidence with a shared rubric.</p><span className="landing-step-link">Structured evaluations <span aria-hidden="true">→</span></span></article>
          <div className="landing-step-connector" aria-hidden="true"><span>→</span></div>
          <article><span className="landing-step-number">03</span><span className="landing-step-icon"><WorkspaceIcon name="insights" size={22}/></span><h3>Make informed decisions</h3><p>Use concise insights and supporting evidence to guide recruiter judgment.</p><span className="landing-step-link">Evidence-led review <span aria-hidden="true">→</span></span></article>
        </div>
      </section>

      <section className="landing-capabilities landing-section" id="product" data-landing-reveal>
        <div className="landing-capabilities-heading"><div><p className="landing-section-kicker">Inside DevRank</p><h2>One workspace for the hiring review.</h2></div><p>Designed to make context easier to find and results easier to interpret.</p></div>
        <div className="landing-capability-feature"><div className="landing-capability-index">A / Evidence</div><div className="landing-capability-copy"><h3>Keep profile evidence in context.</h3><p>Organize candidate information alongside available developer platform snapshots, with source and coverage details available for review.</p></div><div className="landing-capability-art landing-evidence-art" aria-hidden="true"><div><span className="landing-art-icon"><WorkspaceIcon name="candidates" size={19}/></span><strong>Candidate profile</strong><small>Evidence snapshot</small></div><div className="landing-art-source"><i/><span>Source details available</span></div><div className="landing-art-lines"><i/><i/><i/></div></div></div>
        <div className="landing-capability-pair">
          <article><div className="landing-capability-index">B / Evaluation</div><span className="landing-pair-icon"><WorkspaceIcon name="evaluations" size={20}/></span><h3>Compare role-based results with context.</h3><p>Review structured category results and role-based rankings, with evidence state and supporting references available.</p><div className="landing-mini-categories" aria-hidden="true"><i/><i/><i/><i/></div></article>
          <article><div className="landing-capability-index">C / Screening</div><span className="landing-pair-icon"><WorkspaceIcon name="screening" size={20}/></span><h3>Keep resume matching distinct.</h3><p>Screen resumes against role details while keeping job-match results separate from developer platform evaluations.</p><div className="landing-mini-screening" aria-hidden="true"><span>Role requirements</span><i/><i/><i/></div></article>
        </div>
      </section>

      <section className="landing-transparency" id="recruiters" data-landing-reveal><div className="landing-transparency-mark" aria-hidden="true">D.</div><div className="landing-transparency-copy"><p className="landing-section-kicker">Evidence with context</p><h2>What’s missing stays visible.</h2><p>Public profile data can be incomplete. DevRank distinguishes missing evidence from a scored result and keeps source information available, so recruiters can interpret findings in context.</p></div><div className="landing-transparency-points"><div><span>01</span><p>Partial evidence is identified.</p></div><div><span>02</span><p>Sources remain available to review.</p></div><div><span>03</span><p>Hiring decisions remain with people.</p></div></div></section>

      <section className="landing-final-cta" data-landing-reveal><div><p className="landing-section-kicker">A better-informed review</p><h2>Bring more clarity to your engineering hiring process.</h2></div><div className="landing-final-actions"><Link to="/signup" className="landing-request">Request access <span aria-hidden="true">↗</span></Link><Link to="/login" className="landing-final-signin">Already have access? Sign in</Link></div></section>

      <footer className="landing-footer"><Link className="landing-brand" to="/" aria-label="DevRank home"><img src={devrankMark} alt=""/><span>devrank<span>.</span></span></Link><p>Candidate context and evaluation support for recruiter teams.</p><nav aria-label="Footer navigation"><a href="#product">Product</a><a href="#how-it-works">How it works</a><Link to="/login">Sign in</Link><Link to="/signup">Request access</Link></nav><small>© 2026 DevRank</small></footer>
    </main>
  );
}
