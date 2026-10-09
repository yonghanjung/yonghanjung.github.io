---
layout: page
title: Misc
permalink: /misc/
nav: true
nav_order: 7
---

<div class="misc-intro">I enjoy teaching my child math in different ways.</div>

<style>
.misc-intro { max-width: 42rem; color: var(--global-text-color, #253c43); font-size: 1.12rem; line-height: 1.65; margin: 0.25rem 0 1.75rem; }
.misc-portfolio { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; padding-bottom: 2rem; }
.misc-project { position: relative; min-width: 0; display: flex; flex-direction: column; padding: 1.5rem; border: 1px solid var(--global-divider-color, #dce4e3); border-radius: 18px; background: var(--global-card-bg-color, #fff); color: var(--global-text-color, #253c43); box-shadow: 0 4px 20px rgba(22, 58, 59, 0.035); }
.misc-project::before { content: ""; height: 4px; width: 40px; background: #168278; border-radius: 4px; margin-bottom: 1.1rem; }
.misc-project--workshop::before { background: #4572a4; }
.misc-project--music::before { background: #b7793b; }
.misc-category { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--global-text-color-light, #667779); margin-bottom: 0.5rem; }
.misc-project h2 { font-size: 1.45rem; font-weight: 600; line-height: 1.3; letter-spacing: -0.02em; margin: 0 0 0.65rem; overflow-wrap: anywhere; }
.misc-project p { font-size: 0.95rem; line-height: 1.55; margin: 0 0 1.25rem; color: var(--global-text-color-light, #667779); }
.misc-play { margin-top: auto; display: inline-flex; justify-content: center; align-items: center; align-self: flex-start; min-height: 44px; padding: 0.5rem 1.2rem; border-radius: 10px; background: #176b66; color: #fff !important; font-size: 0.95rem; font-weight: 600; text-decoration: none !important; }
.misc-project--workshop .misc-play { background: #375d86; }
.misc-play:hover { filter: brightness(1.12); }
.misc-project--music { grid-column: 1 / -1; }
.misc-song-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6rem; }
.misc-song-link { display: flex; align-items: center; justify-content: space-between; gap: 0.65rem; min-width: 0; min-height: 48px; border: 1px solid var(--global-divider-color, #dce4e3); border-radius: 10px; padding: 0.65rem 0.85rem; color: var(--global-text-color, #253c43) !important; font-size: 0.9rem; font-weight: 500; line-height: 1.45; text-decoration: none !important; }
.misc-song-link span:first-child { overflow-wrap: anywhere; }
.misc-song-link span:last-child { color: var(--global-text-color-light, #667779); font-size: 0.9rem; }
.misc-song-link:hover { border-color: #b7793b; }
.misc-play:focus-visible, .misc-song-link:focus-visible { outline: 2px solid #168278; outline-offset: 4px; }
@media (max-width: 767px) { .misc-project { padding: 1.15rem; } .misc-project h2 { font-size: 1.2rem; } .misc-song-links { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .misc-intro { font-size: 1rem; margin-bottom: 1.25rem; } .misc-portfolio { gap: 0.75rem; } .misc-project { padding: 1rem; border-radius: 14px; } .misc-project h2 { font-size: 1.08rem; } .misc-project p { font-size: 0.85rem; } .misc-play { width: 100%; padding: 0.5rem; } .misc-project--music h2 { font-size: 1.3rem; } .misc-song-links { grid-template-columns: 1fr; } }
@media (max-width: 339px) { .misc-portfolio { grid-template-columns: 1fr; } }
</style>

<section class="misc-portfolio" aria-label="Games and music">
  <article class="misc-project">
    <div class="misc-category">Game</div>
    <h2>Multiplication</h2>
    <p>Practice times tables.</p>
    <a class="misc-play" href="{{ '/misc/multiplication/' | relative_url }}" aria-label="Play Multiplication">Play</a>
  </article>
  <article class="misc-project misc-project--workshop">
    <div class="misc-category">Game</div>
    <h2>Math by Hayden.J</h2>
    <p>Add, multiply, and divide.</p>
    <a class="misc-play" href="{{ '/misc/math-by-hayden-j/' | relative_url }}" aria-label="Play Math by Hayden.J">Play</a>
  </article>
  <article class="misc-project misc-project--music">
    <div class="misc-category">Music</div>
    <h2>Multiplication Groove Series</h2>
    <p>Multiplication songs made with Suno AI.</p>
    <div class="misc-song-links">
      <a class="misc-song-link" href="https://suno.com/s/Wh7q6oUGxYt9ZsJa" aria-label="Listen to Multiplication Groove v1 on Suno"><span>Multiplication Groove v1</span><span aria-hidden="true">↗</span></a>
      <a class="misc-song-link" href="https://suno.com/s/06ZycMvVBY3mcW3b" aria-label="Listen to Multiplication Groove v2 on Suno"><span>Multiplication Groove v2</span><span aria-hidden="true">↗</span></a>
      <a class="misc-song-link" href="https://suno.com/s/WbTnchucN8Hlid6w" aria-label="Listen to Multiplication Groove v3 on Suno"><span>Multiplication Groove v3</span><span aria-hidden="true">↗</span></a>
      <a class="misc-song-link" href="https://suno.com/s/AB6aVVpelAqtRd93" aria-label="Listen to Count It Up on Suno"><span>Count It Up</span><span aria-hidden="true">↗</span></a>
      <a class="misc-song-link" href="https://suno.com/s/aW7MYnyR268BMxcJ" aria-label="Listen to Count It Up 2 on Suno"><span>Count It Up 2</span><span aria-hidden="true">↗</span></a>
    </div>
  </article>
</section>
