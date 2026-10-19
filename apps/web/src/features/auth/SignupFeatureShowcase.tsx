const features = [
  {
    label: 'Role-specific evaluation',
    title: 'Evaluate for the role at hand.',
    description: 'Apply role-aware criteria so every review reflects the skills that matter for the position.',
    kind: 'role',
  },
  {
    label: 'Developer profile evidence',
    title: 'Bring coding profiles into view.',
    description: 'Keep GitHub, LeetCode, and other coding-platform context alongside each candidate profile.',
    kind: 'profiles',
  },
  {
    label: 'Consistent candidate scoring',
    title: 'Compare candidates consistently.',
    description: 'Use a shared, role-specific scoring approach to understand strengths across a shortlist.',
    kind: 'ranking',
  },
  {
    label: 'Evidence-backed decisions',
    title: 'Keep the evidence behind every score.',
    description: 'Review saved platform snapshots alongside evaluations to make informed recruiter decisions.',
    kind: 'evidence',
  },
  {
    label: 'AI analysis',
    title: 'Understand the evaluation.',
    description: 'Explore optional evidence-grounded explanations while the underlying evaluation scores stay unchanged.',
    kind: 'analysis',
  },
] as const;

function ReportPreview({ kind }: { kind: (typeof features)[number]['kind'] }) {
  const title = kind === 'role' ? 'Evaluation setup' : kind === 'profiles' ? 'Candidate profile' : kind === 'ranking' ? 'Candidate comparison' : kind === 'analysis' ? 'AI analysis' : 'Evaluation report';

  return <div className={`signup-preview signup-preview--${kind}`} aria-hidden="true">
    <div className="signup-preview-bar"><span/><span/><span/><small>{title}</small></div>
    {kind === 'role' && <div className="signup-preview-body">
      <div className="signup-preview-report-heading"><div><small>EVALUATION PROFILE</small><strong>Software developer</strong></div><span className="signup-preview-pill">ROLE ALIGNED</span></div>
      <div className="signup-preview-divider"/>
      <small className="signup-preview-section-label">EVALUATION CATEGORIES <span>WEIGHTED FOR ROLE</span></small>
      <div className="signup-preview-metric"><span>Problem solving</span><i><b style={{width:'72%'}}/></i></div>
      <div className="signup-preview-metric"><span>Code quality</span><i><b style={{width:'54%'}}/></i></div>
      <div className="signup-preview-metric"><span>Technical context</span><i><b style={{width:'64%'}}/></i></div>
      <small className="signup-preview-note">Illustrative interface preview</small>
    </div>}
    {kind === 'profiles' && <div className="signup-preview-body signup-preview-profiles-body">
      <div className="signup-preview-profile"><span>AM</span><div><i/><i/></div><small>DEVELOPER</small></div>
      <div className="signup-preview-profile-row"><b>GH</b><span><strong>GitHub</strong><small>Public profile</small></span><i/></div>
      <div className="signup-preview-profile-row"><b>LC</b><span><strong>LeetCode</strong><small>Candidate-provided context</small></span><i/></div>
      <div className="signup-preview-profile-row"><b>CP</b><span><strong>Coding platform</strong><small>Candidate-provided context</small></span><i/></div>
    </div>}
    {kind === 'ranking' && <div className="signup-preview-body signup-preview-ranking-body">
      <div className="signup-preview-report-heading"><div><small>SOFTWARE DEVELOPER</small><strong>Shortlist overview</strong></div><span>3 candidates</span></div>
      {['Alex Morgan', 'Jordan Kim', 'Sam Rivera'].map((name, index) => <div className="signup-preview-rank-row" key={name}><small>0{index + 1}</small><span className="signup-preview-avatar">{name.split(' ').map((part)=>part[0]).join('')}</span><span className="signup-preview-rank-name"><strong>{name}</strong><small>{['Strong','Good','Growing'][index]} role alignment</small></span><strong className="signup-preview-score">{[86,78,71][index]}</strong></div>)}
      <small className="signup-preview-note">Illustrative scores · Review evidence before deciding</small>
    </div>}
    {kind === 'evidence' && <div className="signup-preview-body">
      <div className="signup-preview-report-heading"><div><small>SCORING VERSION</small><strong>Saved evaluation</strong></div><span className="signup-preview-pill"><i/> SNAPSHOT ATTACHED</span></div>
      <div className="signup-preview-evidence">
        <div className="signup-preview-ring"><span>—</span></div>
        <div className="signup-preview-bars"><div><small>Problem solving</small><i><b style={{width:'72%'}}/></i></div><div><small>Code quality</small><i><b style={{width:'52%'}}/></i></div><div><small>Profile context</small><i><b style={{width:'82%'}}/></i></div></div>
      </div>
      <div className="signup-preview-evidence-foot"><span><i/> Evidence snapshot</span><span>Provenance preserved</span></div>
    </div>}
    {kind === 'analysis' && <div className="signup-preview-body">
      <div className="signup-preview-analysis-heading"><span>✳</span><div><strong>Evidence-grounded analysis</strong><small>Separate from evaluation scores</small></div></div>
      <div className="signup-preview-analysis-card"><small>SUMMARY</small><i/><i/><i/></div>
      <div className="signup-preview-analysis-columns"><div><small>STRENGTH</small><i/></div><div><small>SUPPORTING EVIDENCE</small><i/><i/></div></div>
      <small className="signup-preview-note">Explanations do not change saved scores.</small>
    </div>}
  </div>;
}

export function SignupFeatureShowcase() {
  const initialSlide = 3;
  const activeIndex = initialSlide;
  const activeFeature = features[activeIndex];

  return <aside className="signup-showcase" aria-label="DevRank product features">
    <div className="signup-showcase-ambient" aria-hidden="true"><i className="signup-orbit signup-orbit-one"/><i className="signup-orbit signup-orbit-two"/><i className="signup-diamond signup-diamond-one"/><i className="signup-diamond signup-diamond-two"/><span className="signup-light signup-light-one"/><span className="signup-light signup-light-two"/></div>
    <div className="signup-showcase-content">
      <div className="signup-showcase-heading"><span>THE DEVRANK WORKFLOW</span><h2>Make every review<br/>more considered.</h2><p>A focused workspace for evidence-informed developer hiring.</p></div>
      <div className="signup-showcase-slide" key={activeFeature.kind} aria-live="off">
        <ReportPreview kind={activeFeature.kind}/>
        <div className="signup-feature-copy"><span><i/>{activeFeature.label}</span><h3>{activeFeature.title}</h3><p>{activeFeature.description}</p></div>
      </div>
      <div className="signup-showcase-pagination" aria-hidden="true"><span className="signup-showcase-dots">{features.map((feature, index)=><i key={feature.kind} className={index===activeIndex?'active':undefined}/>)}</span><small>{String(activeIndex+1).padStart(2,'0')} <i/> {String(features.length).padStart(2,'0')}</small></div>
      <p className="signup-showcase-caption">Illustrative product preview · Interface and evidence shown for demonstration</p>
    </div>
  </aside>;
}
