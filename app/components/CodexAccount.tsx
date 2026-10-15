"use client";

import { useEffect, useState } from "react";
import { useAssistantName } from "../lib/assistant-name";

type Account = { signedIn?: boolean; pending?: boolean; authUrl?: string; error?: string };

export default function CodexAccount() {
  const name = useAssistantName();
  const [account, setAccount] = useState<Account>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const response = await fetch("/api/codex", { cache: "no-store", signal: controller.signal });
        const next: Account = await response.json();
        if (controller.signal.aborted) return;
        setAccount(next);
        if (next.pending) timer = setTimeout(check, 2000);
      } catch { if (!controller.signal.aborted) setAccount({ error: "Could not check Codex login." }); }
    };
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [account.pending]);

  const changeAccount = async (action: "login" | "logout") => {
    setBusy(true);
    try {
      const response = await fetch("/api/codex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result: Account = await response.json();
      setAccount({ ...result, pending: Boolean(result.authUrl) });
    } catch { setAccount({ error: "Codex login failed. Try again." }); }
    finally { setBusy(false); }
  };

  return <div className="codex-account">
    {account.signedIn ? <><span>ChatGPT connected</span><button type="button" disabled={busy} onClick={() => void changeAccount("logout")}>Sign out of {name}</button></> :
      account.authUrl ? <a href={account.authUrl} target="_blank" rel="noreferrer">Continue to ChatGPT sign-in ↗</a> :
      <button type="button" disabled={busy} onClick={() => void changeAccount("login")}>{busy ? "Connecting…" : "Sign in with ChatGPT"}</button>}
    {account.pending ? <span role="status">Finish sign-in in your browser…</span> : null}
    {account.error ? <span role="status">{account.error}</span> : null}
  </div>;
}
