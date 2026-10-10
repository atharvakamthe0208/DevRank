import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address to continue.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    navigate('/dashboard');
  }

  return <main className="login-page"><div className="login-brand"><Link to="/dashboard" className="brand"><span className="brand-mark">d.</span><span>devrank<span className="brand-period">.</span></span></Link><div className="login-trust">✦ <span>Smarter hiring, backed by data.</span></div></div><div className="login-layout"><section className="login-form-wrap"><span className="login-kicker">WELCOME BACK</span><h1>Good to see you<br/>again<span className="brand-period">.</span></h1><p className="login-intro">Sign in to your workspace and pick up where you left off.</p><form className="login-form" onSubmit={handleSubmit} noValidate><label htmlFor="email">Work email</label><div className="input-wrap"><span>✉</span><input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} /></div><div className="password-label"><label htmlFor="password">Password</label><button type="button" className="text-link" onClick={() => setError('Password reset is not available in this demo.')}>Forgot password?</button></div><div className="input-wrap"><span>⌑</span><input id="password" type="password" autoComplete="current-password" placeholder="At least 8 characters" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} /></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button login-submit" type="submit">Sign in <span>→</span></button></form><p className="login-legal">By continuing, you agree to our <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</p><p className="login-demo-note"><strong>Demo sign in</strong> · Any valid email and 8+ character password will work.</p></section><aside className="login-visual"><div className="visual-orbit orbit-one"/><div className="visual-orbit orbit-two"/><div className="visual-sun">d.</div><div className="floating-score"><span>OVERALL SCORE</span><strong>92<small>/100</small></strong><em>↗ 4.2% this month</em></div><div className="visual-quote"><span>✦ &nbsp; BUILT FOR BETTER HIRING</span><blockquote>“The best teams are built on<br/>great people, and great insight.”</blockquote><small>DevRank candidate intelligence</small></div></aside></div><footer className="login-footer"><span>© 2026 DevRank</span><span>Demo experience <i/></span></footer><p className="auth-disclaimer">Authentication is mocked for this demo and is not production-ready.</p></main>;
}
