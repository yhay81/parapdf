import { useDocumentState, useSession } from "parapdf";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.tsx";

/** A bar along the top of the pages while the document downloads: its share, or a sweep. */
export function LoadingBar() {
  const status = useDocumentState((state) => state.status);
  const progress = useDocumentState((state) => state.progress);
  if (status !== "loading") return null;
  const share = progress?.total ? Math.min(progress.loaded / progress.total, 1) : null;
  return (
    <div
      className="demo-progress"
      role="progressbar"
      aria-label="Loading the document"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={share === null ? undefined : Math.round(share * 100)}
    >
      <span style={share === null ? undefined : { width: `${share * 100}%` }} />
    </div>
  );
}

/** Why the document did not open, which the viewport itself does not show, and opening it again. */
export function ErrorNotice({ onRetry }: { onRetry: () => void }) {
  const status = useDocumentState((state) => state.status);
  const error = useDocumentState((state) => state.error);
  if (status !== "error") return null;
  return (
    <div className="demo-overlay">
      <div className="demo-card" role="alert">
        <span className="demo-card-icon" data-tone="danger">
          <Icon name="alert" size={24} />
        </span>
        <h2>The document could not be opened</h2>
        {error ? <p>{error}</p> : null}
        <button type="button" className="demo-secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** Asks for the password of an encrypted document while its session waits for one. */
export function PasswordDialog({ title, hint }: { title: string; hint?: string }) {
  const session = useSession();
  const reason = useDocumentState((state) => state.passwordReason);
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (reason) input.current?.focus();
  }, [reason]);
  if (reason === null) return null;
  return (
    <div className="demo-overlay">
      <form
        className="demo-card"
        role="dialog"
        aria-labelledby="demo-password-title"
        aria-describedby="demo-password-about"
        onSubmit={(event) => {
          event.preventDefault();
          session.submitPassword(password);
          setPassword("");
        }}
      >
        <span className="demo-card-icon">
          <Icon name="lock" size={24} />
        </span>
        <h2 id="demo-password-title">
          {reason === "incorrect" ? "Incorrect password" : "Password required"}
        </h2>
        <p id="demo-password-about">
          {reason === "incorrect"
            ? "That password does not open this document. Try again."
            : `“${title}” is encrypted. Enter its password to open it.`}
          {hint ? (
            <>
              {" "}
              This sample's password is <code>{hint}</code>.
            </>
          ) : null}
        </p>
        <input
          ref={input}
          type="password"
          aria-label="Password"
          placeholder="Password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="demo-card-actions">
          <button
            type="button"
            className="demo-secondary"
            onClick={() => session.submitPassword(null)}
          >
            Cancel
          </button>
          <button type="submit" className="demo-primary">
            Open
          </button>
        </div>
      </form>
    </div>
  );
}

/** What dropping a PDF on the window does. */
export function DropHint() {
  return (
    <div className="demo-drop" aria-hidden="true">
      <span className="demo-card-icon">
        <Icon name="open" size={28} />
      </span>
      <strong>Drop a PDF to open it</strong>
      <span>It stays in your browser.</span>
    </div>
  );
}
