import type { Section } from '../types';
import './SectionBar.css';

interface SectionBarProps {
  sections: Section[];
  currentSectionIndex: number;
  nextSectionIndex: number | null;
  currentBar: number;
  isLeader: boolean;
  onQueueSection: (index: number) => void;
  onChangeSection: (index: number) => void;
}

export function SectionBar({
  sections,
  currentSectionIndex,
  nextSectionIndex,
  currentBar,
  isLeader,
  onQueueSection,
  onChangeSection,
}: SectionBarProps) {
  const currentSection = sections[currentSectionIndex];
  const barsInSection = currentSection?.bars || 0;
  const sectionProgress = barsInSection > 0 ? (currentBar % barsInSection) + 1 : currentBar + 1;
  const barsRemaining = barsInSection > 0 ? barsInSection - sectionProgress + 1 : 0;

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
        {sections.map((section, index) => (
          <button
            key={section.id}
            className={`section-button ${index === currentSectionIndex ? 'current' : ''} ${
              index === nextSectionIndex ? 'queued' : ''
            }`}
            onClick={() => {
              if (isLeader) {
                if (index === nextSectionIndex) {
                  // Double-click to immediately change
                  onChangeSection(index);
                } else {
                  onQueueSection(index);
                }
              }
            }}
            disabled={!isLeader}
            title={isLeader ? 'Click to queue, double-click to change now' : 'Only the leader can change sections'}
          >
            <span className="button-name">{section.name}</span>
            <span className="button-bars">{section.bars} bars</span>
          </button>
        ))}
      </div>

      {!isLeader && (
        <div className="leader-notice">
          Waiting for leader to control sections
        </div>
      )}
    </div>
  );
}
