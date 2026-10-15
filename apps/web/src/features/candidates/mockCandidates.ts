export type Candidate = {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: string;
  location: string;
  experience: string;
  email: string;
  github: string;
  leetcode: string;
  hackerrank: string;
  score: number;
  trend: string;
  updated: string;
  skills: string[];
  scores: { label: string; value: number }[];
};

const scoreAreas = [
  'Problem Solving',
  'Development Skills',
  'Coding Consistency',
  'Open Source',
  'Competitive Coding',
  'Technical Impact',
];

function candidate(
  input: Omit<Candidate, 'scores'> & { dimensions: number[] },
): Candidate {
  const { dimensions, ...details } = input;
  return {
    ...details,
    scores: scoreAreas.map((label, index) => ({ label, value: dimensions[index] })),
  };
}

export const candidates: Candidate[] = [5 
  candidate({ id: 'maya-chen', name: 'Maya Chen', role: 'Senior Frontend Engineer', initials: 'MC', color: 'lavender', location: 'San Francisco, CA', experience: '6 years', email: 'maya.chen@example.com', github: 'mayachen', leetcode: 'maya_codes', hackerrank: 'mayachen', score: 92, trend: '+4.2%', updated: '2 hours ago', skills: ['React', 'TypeScript', 'GraphQL', 'Design systems'], dimensions: [94, 96, 88, 92, 84, 98] }),
  candidate({ id: 'marcus-johnson', name: 'Marcus Johnson', role: 'Full Stack Engineer', initials: 'MJ', color: 'peach', location: 'New York, NY', experience: '4 years', email: 'marcus.j@example.com', github: 'marcusj-dev', leetcode: 'mj_solutions', hackerrank: 'marcusj', score: 87, trend: '+2.8%', updated: '5 hours ago', skills: ['Node.js', 'Python', 'PostgreSQL', 'AWS'], dimensions: [89, 87, 90, 82, 86, 88] }),
  candidate({ id: 'priya-sharma', name: 'Priya Sharma', role: 'Backend Engineer', initials: 'PS', color: 'mint', location: 'Austin, TX', experience: '5 years', email: 'priya.s@example.com', github: 'priyasharma-dev', leetcode: 'priya_s', hackerrank: 'priya-sharma', score: 84, trend: '+1.6%', updated: 'Yesterday', skills: ['Go', 'Kubernetes', 'Redis', 'Microservices'], dimensions: [91, 83, 86, 79, 88, 82] }),
  candidate({ id: 'alex-rivera', name: 'Alex Rivera', role: 'Software Engineer', initials: 'AR', color: 'blue', location: 'Seattle, WA', experience: '3 years', email: 'alex.r@example.com', github: 'alexrivera', leetcode: 'ar_codes', hackerrank: 'alexrivera', score: 78, trend: '+3.1%', updated: 'Yesterday', skills: ['Java', 'Spring Boot', 'Docker', 'MySQL'], dimensions: [82, 80, 76, 72, 84, 75] }),
  candidate({ id: 'jordan-lee', name: 'Jordan Lee', role: 'Frontend Engineer', initials: 'JL', color: 'yellow', location: 'Remote', experience: '2 years', email: 'jordan.lee@example.com', github: 'jordanlee-dev', leetcode: 'jlee_codes', hackerrank: 'jordanl', score: 71, trend: '+0.9%', updated: '2 days ago', skills: ['Vue.js', 'JavaScript', 'CSS', 'Figma'], dimensions: [74, 77, 70, 66, 68, 72] }),
];

export const candidateStats = {
  total: 48,
  average: Math.round(candidates.reduce((sum, item) => sum + item.score, 0) / candidates.length),
  top: candidates[0],
  activeThisWeek: 12,
};
