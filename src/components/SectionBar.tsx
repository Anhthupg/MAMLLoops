import type { Section, SectionVote, CreateSectionVote } from '../types';
import './SectionBar.css';

interface SectionBarProps {
  sections: Section[];
  currentSectionIndex: number;
  nextSectionIndex: number | null;
  sectionVotes: SectionVote[];
  createSectionVotes: CreateSectionVote[];
  playerCount: number;
  currentBar: number;
  myPlayerId: string;
  onVoteSection: (index: number) => void;
  onVoteCreateSection: (hasMemory: boolean) => void;
}

export function SectionBar({
  sections,
  currentSectionIndex,
  nextSectionIndex,
  sectionVotes,
  createSectionVotes,
  playerCount,
  currentBar,
  myPlayerId,
  onVoteSection,
  onVoteCreateSection,
}: SectionBarProps) {
  const currentSection = sections[currentSectionIndex];
  const barsInSection = currentSection?.bars || 0;
  const sectionProgress = barsInSection > 0 ? (currentBar % barsInSection) + 1 : currentBar + 1;
  const barsRemaining = barsInSection > 0 ? barsInSection - sectionProgress + 1 : 0;

  // Count votes for each section
  const voteCounts = new Map<number, number>();
  sectionVotes.forEach(v => {
    voteCounts.set(v.sectionIndex, (voteCounts.get(v.sectionIndex) || 0) + 1);
  });

  // Find my current vote
  const myVote = sectionVotes.find(v => v.playerId === myPlayerId)?.sectionIndex;

  // Check if I've voted to create a section
  const myCreateVote = createSectionVotes.find(v => v.playerId === myPlayerId);
  const createVoteCount = createSectionVotes.length;
  const createVotesNeeded = Math.ceil(playerCount / 2 + 0.1);

  return (
    <div className="section-bar">
      <div className="section-header">
        <div className="current-section">
          <span className="section-label">Section</span>
          <span className="section-name">{currentSection?.name || '—'}</span>
        </div>

        {nextSectionIndex !== null && (
          <div className="next-section">
            <span className="next-label">Next:</span>
            <span className="next-name">{sections[nextSectionIndex]?.name}</span>
            <span className="next-countdown">in {barsRemaining} bars</span>
          </div>
        )}

        {barsInSection > 0 && (
          <div className="section-progress">
            <div
              className="progress-fill"
              style={{ width: `${(sectionProgress / barsInSection) * 100}%` }}
            />
            <span className="progress-text">
              {sectionProgress} / {barsInSection}
            </span>
          </div>
        )}
      </div>

      <div className="section-buttons">
        {sections.map((section, index) => {
          const votes = voteCounts.get(index) || 0;
          const iVoted = myVote === index;
          const isCurrent = index === currentSectionIndex;
          const isQueued = index === nextSectionIndex;

          return (
            <button
              key={section.id}
              className={`section-button ${isCurrent ? 'current' : ''} ${isQueued ? 'queued' : ''} ${iVoted ? 'voted' : ''}`}
              onClick={() => onVoteSection(index)}
              title={`Vote for ${section.name}${votes > 0 ? ` (${votes} vote${votes > 1 ? 's' : ''})` : ''}`}
            >
              <span className="button-name">{section.name}</span>
              {votes > 0 && !isQueued && (
                <span className="vote-count">{votes}/{Math.ceil(playerCount / 2 + 0.1)}</span>
              )}
              {isQueued && <span className="queued-indicator">!</span>}
            </button>
          );
        })}
      </div>

      <div className="create-section-buttons">
        <button
          className={`create-section-btn ${myCreateVote && !myCreateVote.hasMemory ? 'voted' : ''}`}
          onClick={() => onVoteCreateSection(false)}
          title="Save this loop combination as a new section (marker only)"
        >
          <span className="btn-icon">+</span>
          <span className="btn-label">New</span>
          {createVoteCount > 0 && (
            <span className="vote-count">{createVoteCount}/{createVotesNeeded}</span>
          )}
        </button>
        <button
          className={`create-section-btn memory ${myCreateVote?.hasMemory ? 'voted' : ''}`}
          onClick={() => onVoteCreateSection(true)}
          title="Save with patterns (recalls exact loop states)"
        >
          <span className="btn-icon">+M</span>
          <span className="btn-label">Memory</span>
        </button>
      </div>

      {playerCount > 1 && (
        <div className="vote-notice">
          Vote to change or create sections
        </div>
      )}
    </div>
  );
}
