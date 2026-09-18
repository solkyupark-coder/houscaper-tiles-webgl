"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mountHouscaper } from "../houscaper-engine.js";
import { createClient } from "../lib/supabase/client";
import AuthModal from "./AuthModal";

export default function Houscaper() {
  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReason, setAuthReason] = useState("save");
  const [saveStatus, setSaveStatus] = useState("");
  const [builds, setBuilds] = useState([]);
  const [buildsOpen, setBuildsOpen] = useState(false);
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const pendingActionRef = useRef(null); // 'save' | 'list' | null

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    let active = true;
    let cleanup = null;
    (async () => {
      try {
        const api = await mountHouscaper(el);
        if (!active) {
          api.dispose();
          return;
        }
        apiRef.current = api;
        cleanup = () => api.dispose();
      } catch (err) {
        console.error(err);
        if (!active) return;
        const stats = el.querySelector("#stats");
        if (stats) stats.textContent = "Houscaper failed to start";
      }
    })();
    return () => {
      active = false;
      cleanup?.();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    let supabase;
    try {
      supabase = createClient();
    } catch {
      return undefined;
    }
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshBuilds = useCallback(async () => {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return [];
    setLoadingBuilds(true);
    try {
      const { data, error } = await supabase
        .from("builds")
        .select("id,title,created_at")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      setBuilds(data || []);
      return data || [];
    } finally {
      setLoadingBuilds(false);
    }
  }, []);

  const doSave = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    setSaveStatus("저장 중…");
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        pendingActionRef.current = "save";
        setAuthReason("save");
        setAuthOpen(true);
        setSaveStatus("");
        return;
      }
      const snapshot = api.getSnapshot();
      const title = `Build ${new Date().toLocaleString("ko-KR")}`;
      const { error } = await supabase.from("builds").insert({
        user_id: auth.user.id,
        title,
        snapshot,
      });
      if (error) throw error;
      setSaveStatus("저장됨 ✓");
      setTimeout(() => setSaveStatus(""), 2500);
      if (buildsOpen) await refreshBuilds();
    } catch (err) {
      console.error(err);
      setSaveStatus(err.message || "저장 실패");
    }
  }, [buildsOpen, refreshBuilds]);

  const openBuilds = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        pendingActionRef.current = "list";
        setAuthReason("save");
        setAuthOpen(true);
        return;
      }
      setBuildsOpen(true);
      await refreshBuilds();
    } catch (err) {
      setSaveStatus(err.message || "목록 불러오기 실패");
    }
  }, [refreshBuilds]);

  const loadBuild = useCallback(async (id) => {
    setSaveStatus("불러오는 중…");
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("builds")
        .select("id,title,snapshot")
        .eq("id", id)
        .single();
      if (error) throw error;
      const ok = apiRef.current?.loadSnapshot(data.snapshot);
      if (!ok) throw new Error("스냅샷을 적용하지 못했어요");
      setSaveStatus(`불러옴: ${data.title}`);
      setBuildsOpen(false);
      setTimeout(() => setSaveStatus(""), 2500);
    } catch (err) {
      console.error(err);
      setSaveStatus(err.message || "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    if (!user || !pendingActionRef.current) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action === "save") void doSave();
    if (action === "list") void openBuilds();
  }, [user, doSave, openBuilds]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setBuilds([]);
    setBuildsOpen(false);
  }

  return (
    <>
      <main ref={mountRef} className="houscaper">
        <section id="hud" aria-label="Houscaper controls">
          <header>
            <p className="eyebrow">Rhino 22.3dm / family isolated</p>
            <h1>Houscaper</h1>
          </header>
          <p className="dim">좌클릭 추가 · 우클릭 제거 · 드래그 회전 · 휠 줌</p>

          <label className="field" htmlFor="renderMode">
            <span>Render</span>
            <select id="renderMode" defaultValue="architectural">
              <option value="architectural">Rhino architectural</option>
              <option value="surface">BMC surface</option>
            </select>
          </label>

          <label className="field" htmlFor="tileFamily">
            <span>Geometry family</span>
            <select id="tileFamily" aria-label="Geometry family" />
          </label>

          <div id="brushes" aria-label="Voxel brush">
            <button className="active" data-brush="1" type="button">base</button>
            <button data-brush="2" type="button">floor</button>
            <button data-brush="4" type="button">opening</button>
            <button data-brush="5" type="button">window</button>
          </div>

          <div className="legend">
            <span><i style={{ background: "#c1554d" }} />roof</span>
            <span><i style={{ background: "#ede5d8" }} />wall</span>
            <span><i style={{ background: "#8da0ae" }} />floor</span>
            <span><i style={{ background: "#7d5fa0" }} />extra</span>
          </div>

          <label className="check">
            <input type="checkbox" id="showVoxels" />
            <span>복셀 박스 보기</span>
          </label>

          <div className="save-row">
            <button type="button" className="save-btn" onClick={() => void doSave()}>
              저장
            </button>
            <button type="button" className="account-btn" onClick={() => void openBuilds()}>
              내 프로젝트
            </button>
          </div>
          <div className="account-row">
            {user ? (
              <button type="button" className="account-link" onClick={() => void signOut()} title={user.email || ""}>
                {user.email || "로그아웃"}
              </button>
            ) : (
              <span className="account-hint">저장·불러오기할 때만 로그인</span>
            )}
          </div>
          {saveStatus ? <div className="save-status" aria-live="polite">{saveStatus}</div> : null}

          <div id="stats" aria-live="polite">Rhino family loading…</div>
        </section>
        <div id="msg" role="status" />
      </main>

      {buildsOpen ? (
        <div className="builds-backdrop" role="presentation" onClick={() => setBuildsOpen(false)}>
          <div className="builds-panel" role="dialog" aria-label="내 프로젝트" onClick={(e) => e.stopPropagation()}>
            <div className="builds-head">
              <h2>내 프로젝트</h2>
              <button type="button" className="builds-close" onClick={() => setBuildsOpen(false)}>닫기</button>
            </div>
            {loadingBuilds ? (
              <p className="builds-empty">불러오는 중…</p>
            ) : builds.length === 0 ? (
              <p className="builds-empty">저장된 프로젝트가 없어요. 저장을 눌러 첫 빌드를 남겨보세요.</p>
            ) : (
              <ul className="builds-list">
                {builds.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => void loadBuild(b.id)}>
                      <strong>{b.title}</strong>
                      <span>{new Date(b.created_at).toLocaleString("ko-KR")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <AuthModal
        open={authOpen}
        onClose={() => {
          pendingActionRef.current = null;
          setAuthOpen(false);
        }}
        reason={authReason}
      />
    </>
  );
}
