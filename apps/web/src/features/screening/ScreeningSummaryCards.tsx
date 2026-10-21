type ScreeningSummaryCardsProps = {
  totalResumes: number;
  successfullyScored: number;
};

export function ScreeningSummaryCards({ totalResumes, successfullyScored }: ScreeningSummaryCardsProps) {
  return <div className="screening-summary-cards" aria-label="Screening summary">
    <article><span>Total Resumes</span><strong>{totalResumes}</strong></article>
    <article><span>Successfully Scored</span><strong>{successfullyScored}</strong></article>
  </div>;
}
