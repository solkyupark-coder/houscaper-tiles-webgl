"use client";

import { useEffect, useRef } from "react";
import { mountHouscaper } from "../houscaper-engine.js";

export default function Houscaper() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mountElement = mountRef.current;
    if (!mountElement) return undefined;

    let active = true;
    let cleanup = null;

    (async () => {
      try {
        const dispose = await mountHouscaper(mountElement);
        if (!active) {
          dispose();
          return;
        }
        cleanup = dispose;
      } catch (error) {
        console.error(error);
        if (!active) return;
        const status = mountElement.querySelector("#stats");
        if (status) status.textContent = "Houscaper failed to start";
      }
    })();

    return () => {
      active = false;
      cleanup?.();
      cleanup = null;
    };
  }, []);

  return (
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
          <button className="active" data-brush="1">base</button>
          <button data-brush="2">floor</button>
          <button data-brush="4">opening</button>
          <button data-brush="5">window</button>
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
        <div id="stats" aria-live="polite">Rhino family loading…</div>
      </section>
      <div id="msg" role="status" />
    </main>
  );
}
