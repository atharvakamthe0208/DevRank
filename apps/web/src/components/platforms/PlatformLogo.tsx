import githubMark from '../../assets/github-mark.svg';
import leetCodeMark from '../../assets/leetcode-mark.svg';
import './platform-logo.css';

export type CodingPlatform = 'github' | 'leetcode';

export function PlatformLogo({ platform, size = 'compact', className = '' }: {
  platform: CodingPlatform;
  size?: 'compact' | 'regular' | 'large';
  className?: string;
}) {
  const src = platform === 'github' ? githubMark : leetCodeMark;
  const name = platform === 'github' ? 'GitHub' : 'LeetCode';
  return <img className={`platform-logo platform-logo-${platform} platform-logo-${size}${className ? ` ${className}` : ''}`} src={src} alt="" aria-hidden="true" draggable="false" data-platform-name={name}/>;
}
