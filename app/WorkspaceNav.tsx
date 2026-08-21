"use client";

export type NavView = "library" | "intake" | "audio-tools" | "live-capture" | "opening" | "workspace" | "preview" | "compare" | "insertion-pages" | "admin";

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
      { view: "intake", label: "New Deposition" },
    ],
  },
  {
    heading: "Audio",
    items: [
      { view: "audio-tools", label: "Audio tools", note: "Processing and repair" },
      { view: "live-capture", label: "Live deposition", note: "Record now, attach to a case later" },
    ],
  },
  {
    heading: "Open deposition",
    items: [
      { view: "opening", label: "Opening", note: "Deposition Opening Procedures", needsDeposition: true },
      { view: "workspace", label: "Workspace", note: "Transcribe, assign speakers, correct the record", needsDeposition: true },
      { view: "preview", label: "Print preview", note: "Continuous and 25-line body pages", needsDeposition: true },
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

export default function WorkspaceNav({ current, hasDeposition, depositionLabel, navigationLocked=false, onNavigate }: {
  current: NavView;
  hasDeposition: boolean;
  depositionLabel?: string;
  navigationLocked?: boolean;
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
              const isCurrent = current === item.view;
              const blocked = (Boolean(item.needsDeposition) && !hasDeposition) || (navigationLocked && !isCurrent);
              return (
                <li key={item.view}>
                  <button
                    type="button"
                    className={`workspace-nav-item ${isCurrent ? "current" : ""}`}
                    aria-current={isCurrent ? "page" : undefined}
                    disabled={blocked}
                    title={blocked ? navigationLocked ? "Stop and finalize the active recording before leaving Live Deposition" : "Open a deposition first" : undefined}
                    onClick={() => onNavigate(item.view)}
                  >
                    <span className="workspace-nav-label">{item.label}</span>
                    {blocked
                      ? <span className="workspace-nav-note">{navigationLocked?"Recording in progress":"Open a deposition first"}</span>
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
