import { Link, useParams } from 'react-router-dom';
import { candidates } from './mockCandidates';

export function CandidateDetailsPage() {
  const { id } = useParams();
  const candidate = candidates.find((person) => person.id === id);
  if (!candidate) return <div className="not-found-card"><span className="not-found-mark">?</span><h1>Candidate not found</h1><p>This demo candidate may have moved or doesn’t exist.</p><Link className="primary-button link-button" to="/dashboard">Back to overview</Link></div>;

  return <div className="detail-page">
    <Link className="back-link" to="/dashboard">← <span>Back to overview</span></Link>
    <div className="detail-profile-card"><div className={`avatar avatar-xl avatar-${candidate.color}`}>{candidate.initials}</div><div className="profile-main"><div className="profile-title-row"><div><h1>{candidate.name}</h1><p>{candidate.role} <span>·</span> {candidate.location}</p></div><button className="secondary-button" type="button">··· <span className="sr-only">More actions</span></button></div><div className="profile-meta"><span>▧ {candidate.experience} experience</span><span>✉ {candidate.email}</span><span className="candidate-status"><i/> Active candidate</span></div><div className="skill-list">{candidate.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div><div className="overall-score"><span>OVERALL SCORE</span><strong>{candidate.score}<small>/100</small></strong><em>↗ {candidate.trend}</em></div></div>

    <section className="detail-section"><div className="section-heading"><div><h2>Score breakdown</h2><p>Performance across six evaluation dimensions</p></div><span className="mock-pill">✦ Sample scores</span></div><div className="score-grid">{candidate.scores.map((item, index) => <article className="dimension-card" key={item.label}><div className="dimension-top"><span className={`dimension-icon dim-${index}`}>{['⌘', '⌁', '◷', '⑂', '♟', '✳'][index]}</span><span className="dimension-index">0{index + 1}</span></div><div className="dimension-score">{item.value}<small>/100</small></div><strong className="dimension-label">{item.label}</strong><div className="score-track"><span style={{ width: `${item.value}%` }} /></div><div className="dimension-foot"><span>Sample score</span><span>{item.value >= 90 ? 'Excellent' : item.value >= 80 ? 'Strong' : 'Good'}</span></div></article>)}</div></section>

    <section className="detail-section profile-links-section"><div className="section-heading"><div><h2>Developer profiles</h2><p>Public profile links provided as demo examples</p></div></div><div className="profile-links">{[{ name: 'GitHub', handle: candidate.github, url: `https://github.com/${candidate.github}`, mark: 'GH', className: 'github-mark' }, { name: 'LeetCode', handle: candidate.leetcode, url: `https://leetcode.com/u/${candidate.leetcode}`, mark: 'LC', className: 'leetcode-mark' }, { name: 'HackerRank', handle: candidate.hackerrank, url: `https://www.hackerrank.com/profile/${candidate.hackerrank}`, mark: 'HR', className: 'hackerrank-mark' }].map((profile) => <a className="profile-link-card" href={profile.url} key={profile.name} target="_blank" rel="noreferrer"><span className={`platform-mark ${profile.className}`}>{profile.mark}</span><span><strong>{profile.name}</strong><small>@{profile.handle}</small></span><span className="external-arrow">↗</span></a>)}</div></section>
    <p className="mock-note"><span>ⓘ</span> Scores and candidate information on this page are illustrative demo content, not an evaluation or hiring recommendation.</p>
  </div>;
}
