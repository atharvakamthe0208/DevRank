import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { MIN_PASSWORD_LENGTH, validateEmail, validateSignup } from './validation';
import { passwordResetRequestFailureMessage, passwordUpdateFailureMessage, requestPasswordReset, updatePasswordFromRecovery, validatePasswordReset } from './password-recovery';
import { supabase } from '../../lib/supabase/client';

function AuthLayout({ eyebrow, title, children, footer }: { eyebrow: string; title: ReactNode; children: ReactNode; footer: ReactNode }) {
  return <main className="login-page auth-page"><div className="login-brand"><Link to="/login" className="brand"><span className="brand-mark">d.</span><span>devrank<span className="brand-period">.</span></span></Link><div className="login-trust">✦ <span>Smarter hiring, backed by data.</span></div></div><div className="login-layout"><section className="login-form-wrap"><span className="login-kicker">{eyebrow}</span><h1>{title}<span className="brand-period">.</span></h1><p className="login-intro">A secure workspace for recruiters to make thoughtful, data-informed hiring decisions.</p>{children}<p className="auth-recruiter-note">Recruiter accounts only. DevRank does not offer candidate sign-in or registration.</p>{footer}</section><aside className="login-visual"><div className="visual-orbit orbit-one"/><div className="visual-orbit orbit-two"/><div className="visual-sun">d.</div><div className="floating-score"><span>RECRUITER WORKSPACE</span><strong>✦</strong><em>Insight for every decision</em></div><div className="visual-quote"><span>✦ &nbsp; BUILT FOR BETTER HIRING</span><blockquote>“Great teams start with<br/>clearer insight.”</blockquote><small>DevRank candidate intelligence</small></div></aside></div><footer className="login-footer"><span>© 2026 DevRank</span><span>Recruiter workspace <i/></span></footer></main>;
}

function FormError({ message }: { message?: string }) { return message ? <small className="auth-field-error" role="alert">{message}</small> : null; }
function PasswordField({ id, label, value, onChange, autoComplete, error }: { id: string; label: string; value: string; onChange: (value: string) => void; autoComplete: string; error?: string }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-field" htmlFor={id}><span>{label}</span><div className="auth-input-wrap"><input id={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} /><button type="button" className="password-toggle" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button></div><FormError message={error}/></label>;
}
function ConfigMessage() { return !supabase ? <p className="form-feedback form-feedback-error" role="alert">Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable authentication.</p> : null; }

export function LoginPage() {
  const { state, error: authError } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const requestedPath = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/dashboard';
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [errors, setErrors] = useState<{email?: string; password?: string}>({});
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  if (state === 'approved') return <Navigate to={returnTo} replace/>;
  if (state === 'admin') return <Navigate to={returnTo === '/dashboard' ? '/admin/recruiters' : returnTo} replace/>;
  if (state === 'profile-missing') return <Navigate to="/dashboard" replace/>;
  if (state === 'pending' || state === 'rejected' || state === 'unconfirmed') return <Navigate to="/access-pending" replace/>;
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(''); const next = { email: validateEmail(email), password: password ? undefined : 'Enter your password.' }; setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    if (!supabase) { setMessage('Authentication is temporarily unavailable because Supabase is not configured.'); return; }
    setBusy(true);
    let authError: { code?: string } | null = null;
    let requestFailed = false;
    try { const result = await supabase.auth.signInWithPassword({ email: email.trim(), password }); authError = result.error; }
    catch { requestFailed = true; setMessage('The sign-in service could not be reached. Check your connection and try again.'); }
    finally { setBusy(false); }
    if (requestFailed) return;
    if (authError) { setMessage(authError.code === 'email_not_confirmed' ? 'Confirm your email using the link Supabase sent before signing in.' : 'We could not sign you in. Check your email and password, then try again.'); return; }
    navigate(returnTo, { replace: true });
  }
  return <AuthLayout eyebrow="RECRUITER SIGN IN" title={<>Welcome back</>} footer={<p className="auth-switch">New to DevRank? <Link to="/signup">Create a recruiter account</Link></p>}>
    <ConfigMessage/>{state==='error'&&authError&&<p className="form-feedback form-feedback-error" role="alert">{authError}</p>}<form className="login-form auth-form" onSubmit={submit} noValidate><label className="auth-field" htmlFor="email"><span>Work email</span><input id="email" type="email" autoComplete="email" value={email} onChange={(e) => {setEmail(e.target.value);setErrors({...errors,email:undefined});}} placeholder="you@company.com" aria-invalid={Boolean(errors.email)}/><FormError message={errors.email}/></label><div className="auth-forgot-row"><Link to="/forgot-password">Forgot password?</Link></div><PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" error={errors.password}/>{message && <p className="form-feedback form-feedback-error" role="alert">{message}</p>}<button className="primary-button login-submit" type="submit" disabled={busy || !supabase}>{busy ? 'Signing in…' : 'Sign in'} <span>→</span></button></form>
  </AuthLayout>;
}

export function SignupPage() {
  const { state } = useAuth(); const [fullName,setFullName] = useState(''); const [email,setEmail] = useState(''); const [password,setPassword] = useState(''); const [confirm,setConfirm] = useState('');
  const [errors,setErrors] = useState<Record<string,string|undefined>>({}); const [message,setMessage] = useState(''); const [busy,setBusy] = useState(false);
  if (state === 'approved') return <Navigate to="/dashboard" replace/>;
  if (state === 'admin') return <Navigate to="/admin/recruiters" replace/>;
  if (state === 'profile-missing') return <Navigate to="/dashboard" replace/>;
  if (state === 'pending' || state === 'rejected' || state === 'unconfirmed') return <Navigate to="/access-pending" replace/>;
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(''); const next = validateSignup(fullName,email,password,confirm); setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    if (!supabase) {setMessage('Authentication is temporarily unavailable because Supabase is not configured.');return;}
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (error) { setMessage('We could not create your account. Check your details and try again.'); return; }
      setMessage(data.session ? 'Account created. Confirm your email; your recruiter access will be available after administrator approval.' : 'If this address can be registered, Supabase will send an email confirmation. After confirmation, an administrator must approve recruiter access.');
    } catch { setMessage('The signup service could not be reached. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  return <AuthLayout eyebrow="RECRUITER SIGN UP" title={<>Build your<br/>workspace</>} footer={<p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>}>
    <ConfigMessage/><form className="login-form auth-form" onSubmit={submit} noValidate><label className="auth-field" htmlFor="full-name"><span>Full name</span><input id="full-name" autoComplete="name" value={fullName} onChange={(e)=>setFullName(e.target.value)} aria-invalid={Boolean(errors.fullName)}/><FormError message={errors.fullName}/></label><label className="auth-field" htmlFor="signup-email"><span>Work email</span><input id="signup-email" type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@company.com" aria-invalid={Boolean(errors.email)}/><FormError message={errors.email}/></label><PasswordField id="signup-password" label={`Password (at least ${MIN_PASSWORD_LENGTH} characters)`} value={password} onChange={setPassword} autoComplete="new-password" error={errors.password}/><PasswordField id="confirm-password" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm}/>{message&&<p className="form-feedback" role="status">{message}</p>}<button className="primary-button login-submit" type="submit" disabled={busy || !supabase}>{busy?'Creating account…':'Create recruiter account'} <span>→</span></button></form>
  </AuthLayout>;
}

export function ForgotPasswordPage() {
  const [email,setEmail]=useState(''); const [error,setError]=useState(''); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();if(busy)return;const invalid=validateEmail(email);setError(invalid??'');setMessage('');if(invalid)return;const authClient=supabase;if(!authClient){setMessage('Authentication is temporarily unavailable because Supabase is not configured.');return;}setBusy(true);try{await requestPasswordReset((address,options)=>authClient.auth.resetPasswordForEmail(address,options),email.trim(),`${window.location.origin}/reset-password`);setMessage('If an account matches that address, password reset instructions will be sent.');}catch(cause){setMessage(passwordResetRequestFailureMessage(cause));}finally{setBusy(false);}}
  return <AuthLayout eyebrow="ACCOUNT RECOVERY" title={<>Reset password</>} footer={<p className="auth-switch"><Link to="/login">← Back to sign in</Link></p>}><ConfigMessage/><form className="login-form auth-form" onSubmit={submit} noValidate><p className="login-intro">Enter your work email and we’ll send password reset instructions if an account matches.</p><label className="auth-field" htmlFor="reset-email"><span>Work email</span><input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e)=>{setEmail(e.target.value);setError('');setMessage('');}} placeholder="you@company.com" aria-invalid={Boolean(error)}/><FormError message={error}/></label>{message&&<p className="form-feedback" role="status">{message}</p>}<button className="primary-button login-submit" disabled={busy||!supabase}>{busy?'Sending…':'Send reset link'} <span>→</span></button></form></AuthLayout>;
}

export function ResetPasswordPage() {
  const {state:authState,session,passwordRecovery,clearPasswordRecovery,signOut}=useAuth();const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [message,setMessage]=useState('');const [errors,setErrors]=useState<Record<string,string|undefined>>({});const [busy,setBusy]=useState(false);const [completed,setCompleted]=useState(false);
  const location=useLocation();const query=new URLSearchParams(location.search);const hash=new URLSearchParams(location.hash.replace(/^#/,''));
  const invalidLink=['error','error_description','error_code'].some((key)=>query.has(key)||hash.has(key));
  async function submit(event:FormEvent){event.preventDefault();if(busy)return;const next=validatePasswordReset(password,confirm);setErrors(next);setMessage('');if(Object.values(next).some(Boolean))return;if(!passwordRecovery||!session?.access_token){setMessage('This reset link is invalid or expired. Request a new password reset email.');return;}const authClient=supabase;if(!authClient){setMessage('Authentication is temporarily unavailable because Supabase is not configured.');return;}setBusy(true);try{await updatePasswordFromRecovery((attributes)=>authClient.auth.updateUser(attributes),password,passwordRecovery&&Boolean(session.access_token));setCompleted(true);setMessage('Your password has been updated. Sign in with your new password.');clearPasswordRecovery();await signOut().catch(()=>undefined);}catch(cause){setMessage(passwordUpdateFailureMessage(cause));}finally{setBusy(false);}}
  if(completed)return <AuthLayout eyebrow="PASSWORD UPDATED" title={<>You’re all<br/>set</>} footer={<p className="auth-switch"><Link to="/login">Continue to recruiter sign in</Link></p>}><p className="form-feedback" role="status">{message}</p></AuthLayout>;
  if(authState==='loading'&&!(passwordRecovery&&session?.access_token))return <AuthLayout eyebrow="SECURE YOUR ACCOUNT" title={<>Checking<br/>reset link</>} footer={<p className="auth-switch"><Link to="/login">Back to sign in</Link></p>}><p className="login-intro" role="status">Restoring the secure recovery session…</p></AuthLayout>;
  if(invalidLink||!passwordRecovery||!session?.access_token)return <AuthLayout eyebrow="SECURE YOUR ACCOUNT" title={<>Reset link<br/>expired</>} footer={<p className="auth-switch"><Link to="/forgot-password">Request another reset email</Link> · <Link to="/login">Sign in</Link></p>}><p className="login-intro">This password recovery link is invalid, expired, or already used. Request a new reset email to continue.</p></AuthLayout>;
  return <AuthLayout eyebrow="SECURE YOUR ACCOUNT" title={<>Choose a new<br/>password</>} footer={<p className="auth-switch"><Link to="/login">Cancel and return to sign in</Link></p>}><form className="login-form auth-form" onSubmit={submit} noValidate><PasswordField id="new-password" label={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`} value={password} onChange={setPassword} autoComplete="new-password" error={errors.password}/><PasswordField id="new-password-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm}/>{message&&<p className="form-feedback form-feedback-error" role="alert">{message}</p>}<button className="primary-button login-submit" disabled={busy||!supabase}>{busy?'Updating…':'Update password'} <span>→</span></button></form></AuthLayout>;
}

export function AccessPendingPage() {
  const {state,profile,signOut}=useAuth();
  if(state==='signed-out') return <Navigate to="/login" replace/>;
  if(state==='approved') return <Navigate to="/dashboard" replace/>;
  if(state==='admin') return <Navigate to="/admin/recruiters" replace/>;
  if(state==='profile-missing') return <Navigate to="/dashboard" replace/>;
  const suspended = profile?.approval_status === 'suspended';
  const rejected = state === 'rejected';
  const notice = state === 'unconfirmed' ? 'Confirm your email using the link Supabase sent you. Then return here.' : rejected ? 'Your recruiter application was reviewed and not approved. Contact a DevRank administrator if you need more information.' : suspended ? 'Recruiter access to this workspace has been suspended. Contact your DevRank administrator.' : 'Your account is registered for recruiter access and is awaiting administrator approval.';
  return <AuthLayout eyebrow="RECRUITER ACCESS" title={rejected ? <>Application<br/>decision</> : <>One more<br/>step</>} footer={<button className="text-link" type="button" onClick={()=>void signOut()}>Sign out</button>}><div className={`form-feedback${suspended || rejected ? ' form-feedback-error' : ''}`}>{notice}</div><p className="auth-pending">{profile?.display_name ? `Signed in as ${profile.display_name}.` : 'You can close this page and return after approval.'} Protected workspace data remains unavailable unless access is approved.</p>{!rejected&&<button className="secondary-button" type="button" onClick={()=>window.location.reload()}>Check access again</button>}</AuthLayout>;
}

export function AuthCallbackPage() {
  const {state,error}=useAuth();
  const location=useLocation();
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/,''));
  const invalidLink = query.has('error') || query.has('error_description') || query.has('error_code') || hash.has('error') || hash.has('error_description') || hash.has('error_code');
  if(state==='approved') return <Navigate to="/dashboard" replace/>;
  if(state==='admin') return <Navigate to="/admin/recruiters" replace/>;
  if(state==='profile-missing') return <Navigate to="/dashboard" replace/>;
  if(state==='pending'||state==='unconfirmed')return <Navigate to="/access-pending" replace/>;
  const statusMessage = invalidLink || state === 'signed-out'
    ? 'This confirmation link is invalid or has expired. Request a fresh confirmation email or sign in if you have already confirmed your address.'
    : state === 'loading' ? 'Confirming your secure Supabase session…' : error || 'Email confirmation may take a moment. Return here after confirming your email.';
  return <AuthLayout eyebrow="VERIFYING ACCOUNT" title={<>Finishing<br/>sign in</>} footer={<p className="auth-switch"><Link to="/login">Return to sign in</Link></p>}><p className="login-intro">{statusMessage}</p></AuthLayout>;
}
