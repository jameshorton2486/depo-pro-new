"use client";

export type NavView = "library" | "intake" | "audio-tools" | "workspace" | "review" | "compare" | "insertion-pages" | "admin";

type Item = {
  view: NavView;
  label: string;
  note?: string;
  needsDeposition?: boolean;
};

type Group = { heading: string; items: Item[] };

// Grouped by what the reporter is doing, not by which module serves it.
const GROUPS: Group[] = [
  {
    heading: "Library",
    items: [
      { view: "library", label: "Depositions" },
      { view: "intake", label: "New deposition" },
    ],
  },
  {
    heading: "Audio",
    items: [
      { view: "audio-tools", label: "Audio tools", note: "Processing and repair" },
    ],
  },
  {
    heading: "Open deposition",
    items: [
      { view: "workspace", label: "Workspace", note: "Transcribe, assign speakers, correct the record", needsDeposition: true },
      { view: "review", label: "Read-through", note: "Reading only — no edits yet", needsDeposition: true },
      { view: "compare", label: "Compare transcripts", note: "Measured source selection", needsDeposition: true },
      { view: "insertion-pages", label: "Certification pages", note: "Texas variants; federal pending", needsDeposition: true },
    ],
  },
  {
    heading: "System",
    items: [
      { view: "admin", label: "Administrator settings", note: "Credentials and readiness" },
    ],
  },
];

export default function WorkspaceNav({ current, hasDeposition, depositionLabel, onNavigate }: {
  current: NavView;
  hasDeposition: boolean;
  depositionLabel?: string;
  onNavigate: (view: NavView) => void;
}) {
  return (
    <nav className="workspace-nav" aria-label="Application screens">
      <div className="workspace-nav-brand">
        <span className="workspace-nav-mark">DP</span>
        <span>Depo<strong>Pro</strong></span>
      </div>

      {GROUPS.map((group) => (
        <div key={group.heading} className="workspace-nav-group">
          <h2>{group.heading}</h2>
          <ul>
            {group.items.map((item) => {
              // An item that needs a deposition is shown rather than hidden, with the reason,
              // so the absence reads as a precondition instead of a missing feature.
              const blocked = Boolean(item.needsDeposition) && !hasDeposition;
              const isCurrent = current === item.view;
              return (
                <li key={item.view}>
                  <button
                    type="button"
                    className={`workspace-nav-item ${isCurrent ? "current" : ""}`}
                    aria-current={isCurrent ? "page" : undefined}
                    disabled={blocked}
                    title={blocked ? "Open a deposition first" : undefined}
                    onClick={() => onNavigate(item.view)}
                  >
                    <span className="workspace-nav-label">{item.label}</span>
                    {blocked
                      ? <span className="workspace-nav-note">Open a deposition first</span>
                      : item.note && <span className="workspace-nav-note">{item.note}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="workspace-nav-footer">
        {hasDeposition
          ? <><span>Open</span><strong>{depositionLabel}</strong></>
          : <span>No deposition open</span>}
      </div>
    </nav>
  );
}
