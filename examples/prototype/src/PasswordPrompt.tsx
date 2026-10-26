import { useDocumentState, useSession } from "parapdf";
import { useState } from "react";

/** Asks for the password of an encrypted document while its session waits for one. */
export function PasswordPrompt() {
  const session = useSession();
  const reason = useDocumentState((state) => state.passwordReason);
  const [password, setPassword] = useState("");
  if (reason === null) return null;
  return (
    <form
      className="password"
      aria-label="Password"
      onSubmit={(event) => {
        event.preventDefault();
        session.submitPassword(password);
        setPassword("");
      }}
    >
      <label>
        {reason === "incorrect"
          ? "Incorrect password. Try again:"
          : "This document is protected. Password:"}
        <input
          type="password"
          value={password}
          // biome-ignore lint/a11y/noAutofocus: the prompt is the only thing to do while it shows.
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit">Open</button>
      <button type="button" onClick={() => session.submitPassword(null)}>
        Cancel
      </button>
    </form>
  );
}
