import devrankMark from '../../assets/devrank-mark.svg';
import './auth-loading.css';

export function AuthLoadingScreen({ message }: { message: string }) {
  return <main className="auth-loading-screen" role="status" aria-live="polite" aria-atomic="true">
    <div className="auth-loading-content">
      <div className="auth-loading-brand">
        <img src={devrankMark} alt="" />
        <span>DevRank</span>
      </div>
      <p>{message}</p>
      <span className="auth-loading-indicator" aria-hidden="true"><i/><i/><i/></span>
    </div>
  </main>;
}
