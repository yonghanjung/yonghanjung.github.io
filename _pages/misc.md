---
layout: page
title: Misc
permalink: /misc/
nav: true
nav_order: 7
---

나는 아이에게 다양한 방식으로 수학을 가르치는 것을 좋아한다.

<style>
.misc-portfolio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.25rem; margin: 2rem 0; }
.misc-project { display: flex; flex-direction: column; padding: 1.5rem; border: 1px solid var(--global-divider-color, #ddd); border-radius: 12px; background: var(--global-card-bg-color, var(--global-bg-color, #fff)); color: var(--global-text-color, #222); }
.misc-project h2 { font-size: 1.35rem; line-height: 1.4; margin: 0 0 0.75rem; }
.misc-project p { line-height: 1.7; margin: 0 0 1.5rem; }
.misc-project .misc-link, .misc-project .misc-pending { margin-top: auto; min-height: 44px; display: inline-flex; align-items: center; align-self: flex-start; font-weight: 600; }
.misc-song-links { margin-top: auto; display: flex; flex-direction: column; gap: 0.25rem; }
.misc-song-links .misc-link { margin-top: 0; }
.misc-project .misc-link { color: var(--global-theme-color, #b509ac); }
.misc-project .misc-link:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
.misc-project .misc-pending { opacity: 0.6; }
@media (max-width: 991px) { .misc-portfolio { grid-template-columns: 1fr; } }
</style>

<section class="misc-portfolio" aria-label="Projects">
  <article class="misc-project">
    <h2>Multiplication</h2>
    <p>곱셈을 연습하는 수학 게임.</p>
    <a class="misc-link" href="{{ '/misc/multiplication/' | relative_url }}" aria-label="Play Multiplication">Play</a>
  </article>
  <article class="misc-project">
    <h2>Multiplication Groove Series</h2>
    <p>Suno AI로 만든 곱셈 노래.</p>
    <div class="misc-song-links">
      <a class="misc-link" href="https://suno.com/s/06ZycMvVBY3mcW3b" aria-label="Listen to Multiplication Groove v2 on Suno">Multiplication Groove v2</a>
      <a class="misc-link" href="https://suno.com/s/Wh7q6oUGxYt9ZsJa" aria-label="Listen to Multiplication Groove v1 on Suno">Multiplication Groove v1</a>
      <a class="misc-link" href="https://suno.com/s/WbTnchucN8Hlid6w" aria-label="Listen to Multiplication Groove v3 on Suno">Multiplication Groove v3</a>
      <a class="misc-link" href="https://suno.com/s/AB6aVVpelAqtRd93" aria-label="Listen to Count It Up on Suno">Count It Up</a>
      <a class="misc-link" href="https://suno.com/s/aW7MYnyR268BMxcJ" aria-label="Listen to Count It Up 2 on Suno">Count It Up 2</a>
    </div>
  </article>
  <article class="misc-project">
    <h2>Math by Hayden.J</h2>
    <p>더하기·곱하기·나누기를 연습하는 수학 게임.</p>
    <a class="misc-link" href="{{ '/misc/math-by-hayden-j/' | relative_url }}" aria-label="Play Math by Hayden.J">Play</a>
  </article>
</section>
