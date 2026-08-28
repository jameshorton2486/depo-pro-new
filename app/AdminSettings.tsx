"use client";
import { FormEvent, useEffect, useState } from "react";
import { apiJson, LOCAL_API_BASE_URL as API } from "./api-client";
type Status = {
  initialized: boolean;
  anthropicConfigured: boolean;
  deepgramConfigured: boolean;
};
type ComponentStatus = {
  ready?: boolean;
  version?: string | null;
  detail?: string;
  error?: string;
  [key: string]: unknown;
};
type Preflight = {
  overallReady: boolean;
  components: Record<string, ComponentStatus>;
};
type KeyTest = {
  anthropic: { ok: boolean; message: string };
  deepgram: { ok: boolean; message: string };
};
type RxStatus = {
  installed: boolean;
  available: boolean;
  status: string;
  product: string;
  version: string | null;
  edition: string | null;
  detectionMethod: string;
  fallback: string;
};
type StorageInventory = {
  depositions:number; depositionIssues:number; audioAudits:number; linkedAudioAudits:number;
  unlinkedAudioAudits:number; unlinkedBytes:number; uniqueOriginals:number; duplicateGroups:number;
  duplicateOriginalBytes:number; corruptAuditCount:number; cleanupAllowed:false;
};
function bytes(value:number){if(value<1024**2)return `${Math.round(value/1024)} KB`;if(value<1024**3)return `${(value/1024**2).toFixed(1)} MB`;return `${(value/1024**3).toFixed(1)} GB`;}
export default function AdminSettings({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null),
    [preflight, setPreflight] = useState<Preflight | null>(null),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [failed, setFailed] = useState(false),
    [saved, setSaved] = useState(false),
    [showKeys, setShowKeys] = useState(false),
    [rx, setRx] = useState<RxStatus | null>(null),
    [keyTest, setKeyTest] = useState<KeyTest | null>(null),
    [testing, setTesting] = useState(false),
    [inventory,setInventory]=useState<StorageInventory|null>(null);
  useEffect(() => {
    Promise.all([
      apiJson<Status>("/api/admin/status",{cache:"no-store"}),
      apiJson<Preflight>("/api/system/preflight",{cache:"no-store"}),
      apiJson<RxStatus>("/api/rx/status",{cache:"no-store"}),
      apiJson<StorageInventory>("/api/storage/inventory",{cache:"no-store"}),
    ])
      .then(([admin, system, rxStatus, storageInventory]) => {
        setStatus(admin);
        setPreflight(system);
        setRx(rxStatus);
        setInventory(storageInventory);
      })
      .catch(() =>
        setMessage(
          "The secure local service is not running. Restart Depo Pro, then try again.",
        ),
      );
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setSaved(false);
    setMessage("");
    const data = new FormData(form);
    try {
      const response = await fetch(`${API}/api/admin/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adminCode: data.get("adminCode"),
          anthropicApiKey: data.get("anthropicApiKey"),
          deepgramApiKey: data.get("deepgramApiKey"),
          claudeModel: data.get("claudeModel"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMessage("Settings saved securely for this Windows user.");
      setFailed(false);
      setSaved(true);
      // Read back what the server actually holds rather than asserting what the form sent. The
      // previous version computed the new status from the field values, so the chips could report
      // "Configured" for a key the store had not kept -- the screen agreeing with itself.
      setStatus(await apiJson<Status>("/api/admin/status", { cache: "no-store" }));
      form.reset();
    } catch (error) {
      // A refusal has to look like one. This message used to render in the same neutral grey as a
      // confirmation, so "Create an administrator access code with at least 8 characters." read as
      // a note rather than as the reason nothing was saved.
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to save settings.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function testKeys() {
    setFailed(false);
    setTesting(true);
    setKeyTest(null);
    try {
      const response = await fetch(`${API}/api/admin/test-keys`, {
          method: "POST",
        }),
        body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "The credential test failed.");
      setKeyTest(body);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The credential test failed.",
      );
    } finally {
      setTesting(false);
    }
  }
  function rows(name: string, value: ComponentStatus) {
    if ("ready" in value) return [{ name, value }];
    return Object.entries(value).map(([child, item]) => ({
      name: `${name}: ${child}`,
      value: item as ComponentStatus,
    }));
  }
  return (
    <main className="admin-shell">
      <header className="intake-topbar">
        <button className="back-button" onClick={onClose}>
          ← Back to Depo Pro
        </button>
        <strong>Administrator Settings</strong>
        <span>Local security</span>
      </header>
      <section className="admin-card">
        <span className="eyebrow">SECURE CONFIGURATION</span>
        <h1>API keys and system readiness</h1>
        <p className="admin-intro">
          Keys are sent only to the localhost service, encrypted with Windows
          Data Protection, and never returned to or stored by the browser.
        </p>
        <div className="security-banner">
          <span>✓</span>
          <div>
            <strong>Protected for your Windows account</strong>
            <p>
              The encrypted file cannot be decrypted under a different Windows
              user. Keys are never displayed after saving.
            </p>
          </div>
        </div>
        {preflight && (
          <section className="preflight">
            <h2>System readiness</h2>
            <p className={preflight.overallReady ? "ready" : "attention"}>
              {preflight.overallReady
                ? "All required components are ready."
                : "One or more components need attention."}
            </p>
            <ul>
              {Object.entries(preflight.components)
                .flatMap(([name, value]) => rows(name, value))
                .map(({ name, value }) => (
                  <li key={name}>
                    <span className={value.ready ? "ready" : "missing"}>
                      {value.ready ? "✓" : "!"}
                    </span>
                    <strong>{name}</strong>
                    <small>
                      {value.version ||
                        value.detail ||
                        value.error ||
                        (value.ready ? "Ready" : "Not ready")}
                    </small>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {inventory&&<section className="preflight"><h2>Local evidence storage</h2><p className={inventory.corruptAuditCount||inventory.depositionIssues?"attention":"ready"}>{inventory.corruptAuditCount||inventory.depositionIssues?"Stored records need attention.":"Stored records passed structural checks."}</p><ul><li><span className="ready">✓</span><strong>Deposition library</strong><small>{inventory.depositions} depositions · {inventory.depositionIssues} structural issues</small></li><li><span className={inventory.unlinkedAudioAudits?"missing":"ready"}>{inventory.unlinkedAudioAudits?"!":"✓"}</span><strong>Unlinked audio work</strong><small>{inventory.unlinkedAudioAudits} of {inventory.audioAudits} audits · {bytes(inventory.unlinkedBytes)}</small></li><li><span className={inventory.duplicateGroups?"missing":"ready"}>{inventory.duplicateGroups?"!":"✓"}</span><strong>Duplicate source recordings</strong><small>{inventory.duplicateGroups} groups · {bytes(inventory.duplicateOriginalBytes)} physically duplicated</small></li></ul><p className="admin-intro">Nothing is deleted automatically. Unlinked Audio Tools work may still be evidence and must be reviewed before cleanup.</p></section>}
        <form onSubmit={save}>
          <label>
            {status?.initialized
              ? "Administrator access code"
              : "Create administrator access code"}
            <input
              name="adminCode"
              type="password"
              minLength={8}
              required
              autoComplete="current-password"
              placeholder="At least 8 characters"
            />
            <small>Required whenever secrets are changed.</small>
          </label>
          <div className="secret-heading">
            <h2>Service credentials</h2>
            <button type="button" onClick={() => setShowKeys(!showKeys)}>
              {showKeys ? "Hide entries" : "Show entries"}
            </button>
          </div>
          <label>
            Anthropic API key{" "}
            <span
              className={`config-status ${status?.anthropicConfigured ? "ready" : ""}`}
            >
              {status?.anthropicConfigured ? "Configured" : "Not configured"}
            </span>
            <input
              name="anthropicApiKey"
              type={showKeys ? "text" : "password"}
              autoComplete="new-password"
              placeholder={
                status?.anthropicConfigured
                  ? "Leave blank to keep existing key"
                  : "sk-ant-..."
              }
            />
          </label>
          <label>
            Deepgram API key{" "}
            <span
              className={`config-status ${status?.deepgramConfigured ? "ready" : ""}`}
            >
              {status?.deepgramConfigured ? "Configured" : "Not configured"}
            </span>
            <input
              name="deepgramApiKey"
              type={showKeys ? "text" : "password"}
              autoComplete="new-password"
              placeholder={
                status?.deepgramConfigured
                  ? "Leave blank to keep existing key"
                  : "Paste Deepgram key"
              }
            />
          </label>
          <label>
            Claude model
            <input
              name="claudeModel"
              defaultValue="claude-sonnet-4-5"
              spellCheck={false}
            />
            <small>
              Change only when intentionally upgrading the configured Claude
              model.
            </small>
          </label>
          {message && (
            <p className={failed ? "admin-message admin-message-failed" : "admin-message"} role={failed ? "alert" : "status"}>
              {message}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={saving}>
              {saving
                ? "Saving securely…"
                : saved
                  ? "Saved"
                  : "Save Secure Settings"}
            </button>
          </div>
        </form>
        <div className="admin-checks">
          <h3>Credentials and processing</h3>
          <p>
            Verify the stored keys reach their providers, and confirm what the
            audio processor found on this machine.
          </p>
          <div className="admin-check-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={testing}
              onClick={testKeys}
            >
              {testing ? "Testing…" : "Test stored keys"}
            </button>
          </div>
          {keyTest && (
            <ul className="admin-check-list">
              <li className={keyTest.anthropic.ok ? "ok" : "bad"}>
                <strong>Claude</strong> {keyTest.anthropic.message}
              </li>
              <li className={keyTest.deepgram.ok ? "ok" : "bad"}>
                <strong>Deepgram</strong> {keyTest.deepgram.message}
              </li>
            </ul>
          )}
          {rx && (
            <ul className="admin-check-list">
              <li className={rx.available ? "ok" : "bad"}>
                <strong>iZotope RX</strong>{" "}
                {rx.available
                  ? `${rx.product} ${rx.version ?? ""} detected by ${rx.detectionMethod}${rx.edition ? ` (${rx.edition} edition)` : ""}`
                  : rx.fallback}
              </li>
            </ul>
          )}
        </div>
        <aside className="secret-rules">
          <h3>Safety rules</h3>
          <ul>
            <li>
              Never paste API keys into notes, case fields, or uploaded
              documents.
            </li>
            <li>Use restricted provider keys and rotate them periodically.</li>
            <li>
              Do not copy the encrypted secrets file to another computer as a
              backup.
            </li>
          </ul>
        </aside>
      </section>
    </main>
  );
}
