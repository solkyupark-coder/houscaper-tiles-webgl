"use client";

import dynamic from "next/dynamic";

const Houscaper = dynamic(() => import("../components/Houscaper"), {
  ssr: false,
  loading: () => (
    <main className="houscaper">
      <section id="hud" aria-label="Houscaper controls">
        <header>
          <p className="eyebrow">Rhino 22.3dm / family isolated</p>
          <h1>Houscaper</h1>
        </header>
        <div id="stats" aria-live="polite">Rhino family loading…</div>
      </section>
    </main>
  ),
});

export default function Home() {
  return <Houscaper />;
}
