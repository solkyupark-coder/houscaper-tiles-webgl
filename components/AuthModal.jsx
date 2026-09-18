"use client";

import { createClient } from "../lib/supabase/client";

export default function AuthModal({ open, onClose, reason = "save" }) {
  if (!open) return null;

  async function signInWithGoogle() {
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(window.location.pathname || "/")}`,
      },
    });
    if (error) {
      console.error(error);
      alert(error.message);
    }
  }

  const title = reason === "save" ? "저장하려면 로그인" : "로그인";
  const blurb =
    reason === "save"
      ? "프로젝트 저장·불러오기는 Google 로그인 후에만 가능해요. 만들기는 로그인 없이 계속해도 됩니다."
      : "Google로 로그인하세요.";

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="eyebrow">Houscaper</p>
        <h2 id="auth-modal-title">{title}</h2>
        <p className="auth-modal-blurb">{blurb}</p>
        <button type="button" className="auth-google-btn" onClick={signInWithGoogle}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 12.3 3 3 12.3 3 24s9.3 21 21 21 21-9.3 21-21c0-1.3-.1-2.7-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 16.1 3 9.3 7.5 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.2 26.7 37 24 37c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.2 40.4 16 45 24 45z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.5 5.5-6.5 6.6l.1.1 6.2 5.2C36.8 41.2 45 35 45 24c0-1.3-.1-2.7-.4-3.5z" />
          </svg>
          Google로 계속
        </button>
        <button type="button" className="auth-cancel" onClick={onClose}>
          나중에
        </button>
      </div>
    </div>
  );
}
