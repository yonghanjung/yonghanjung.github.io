/* One in-page picker for every select. Backing value/change APIs remain intact. */
(() => {
  const entries = new Map();
  let active = null,
    index = 0,
    serial = 0,
    typeText = "",
    typeTimer;
  const popup = document.createElement("div");
  popup.id = "ce-picker-list";
  popup.className = "ce-picker-popup";
  popup.setAttribute("role", "listbox");
  popup.hidden = true;
  document.body.append(popup);
  const options = (e) => [...e.select.options].filter((o) => !o.hidden && !o.parentElement?.hidden),
    enabled = (o) => !o.disabled && !o.parentElement?.disabled;
  function close(focus = false) {
    if (active) {
      active.button.setAttribute("aria-expanded", "false");
      active.button.removeAttribute("aria-activedescendant");
      if (focus && active.button.isConnected) active.button.focus();
    }
    popup.hidden = true;
    active = null;
  }
  function place() {
    if (!active) return;
    const r = active.button.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) {
      close();
      return;
    }
    const width = Math.min(innerWidth - 16, Math.max(120, r.width)),
      below = innerHeight - r.bottom - 12,
      above = r.top - 12,
      desired = Math.min(290, popup.scrollHeight || 290),
      flip = below < desired && above > below,
      height = Math.min(290, Math.max(24, flip ? above : below));
    popup.style.width = width + "px";
    popup.style.left = Math.max(8, Math.min(r.left, innerWidth - width - 8)) + "px";
    popup.style.maxHeight = Math.max(48, height) + "px";
    popup.style.top = flip ? "auto" : Math.min(innerHeight - 48, r.bottom + 4) + "px";
    popup.style.bottom = flip ? innerHeight - r.top + 4 + "px" : "auto";
  }
  function highlight() {
    if (!active) return;
    const children = [...popup.children];
    children.forEach((x, i) => (x.dataset.active = String(i === index)));
    if (children[index]) {
      active.button.setAttribute("aria-activedescendant", children[index].id);
      children[index].scrollIntoView({ block: "nearest" });
    }
  }
  function selectAt(i) {
    if (!active) return;
    const e = active;
    if (e.select.disabled) {
      close();
      return;
    }
    const list = options(e),
      o = list[i];
    if (!o || !enabled(o)) return;
    e.select.value = o.value;
    e.select.dispatchEvent(new Event("input", { bubbles: true }));
    e.select.dispatchEvent(new Event("change", { bubbles: true }));
    sync(e);
    close(true);
  }
  function open(e) {
    if (e.select.disabled || e.select.hidden) return;
    close();
    active = e;
    popup.replaceChildren();
    const list = options(e);
    list.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = e.button.id + "-option-" + i;
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(o.selected));
      b.disabled = !enabled(o);
      b.tabIndex = -1;
      b.textContent = o.label;
      b.dataset.value = o.value;
      b.onclick = () => selectAt(i);
      b.onpointermove = () => {
        if (enabled(o)) {
          index = i;
          highlight();
        }
      };
      popup.append(b);
    });
    index = Math.max(
      0,
      list.findIndex((o) => o.selected)
    );
    popup.hidden = false;
    e.button.setAttribute("aria-expanded", "true");
    place();
    highlight();
  }
  function move(step, end) {
    if (!active) return;
    const list = options(active);
    if (!list.length) return;
    let next = end === undefined ? index + step : end;
    for (let i = 0; i < list.length; i++) {
      next = (next + list.length) % list.length;
      if (enabled(list[next])) {
        index = next;
        highlight();
        return;
      }
      next += step || 1;
    }
  }
  function sync(e) {
    if (!e.select.isConnected) {
      if (active === e) close();
      e.wrap.remove();
      entries.delete(e.select);
      return;
    }
    const s = e.select,
      caption = s.selectedOptions[0]?.label || "Choose…";
    if (e.caption.textContent !== caption) e.caption.textContent = caption;
    e.button.disabled = s.disabled;
    e.wrap.hidden = s.hidden;
    e.button.setAttribute("aria-disabled", String(s.disabled));
    const sig = [s.value, s.disabled, s.hidden, ...[...s.options].map((o) => [o.value, o.label, o.disabled, o.hidden, o.selected].join("|"))].join(
      "~"
    );
    if (active === e && (s.disabled || s.hidden || !e.button.getClientRects().length)) close();
    else if (active === e && e.signature !== undefined && sig !== e.signature) {
      open(e);
    }
    e.signature = sig;
  }
  function install(s) {
    if (entries.has(s) || s.multiple) return;
    const id = s.id || (s.id = "ce-select-" + ++serial),
      label = s.labels?.[0] || s.closest("label"),
      name =
        s.getAttribute("aria-label") ||
        (label?.childNodes &&
          [...label.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join(" ")
            .trim()) ||
        id;
    const wrap = document.createElement("span"),
      button = document.createElement("button"),
      caption = document.createElement("span"),
      arrow = document.createElement("span");
    wrap.className = "ce-picker";
    button.type = "button";
    button.id = id + "-picker";
    button.className = "ce-picker-button";
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-label", name);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-controls", popup.id);
    arrow.textContent = "⌄";
    arrow.setAttribute("aria-hidden", "true");
    button.append(caption, arrow);
    wrap.append(button);
    s.before(wrap);
    s.classList.add("ce-native-select");
    s.tabIndex = -1;
    s.setAttribute("aria-hidden", "true");
    if (label) label.htmlFor = button.id;
    const e = { select: s, button, caption, wrap };
    entries.set(s, e);
    button.onclick = () => (active === e ? close() : open(e));
    button.onkeydown = (event) => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const was = active === e;
        if (!was) open(e);
        if (event.key === "Home") move(1, 0);
        else if (event.key === "End") move(-1, options(e).length - 1);
        else if (was) move(event.key === "ArrowDown" ? 1 : -1);
      } else if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (active === e) selectAt(index);
        else open(e);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      } else if (event.key === "Tab") close();
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        clearTimeout(typeTimer);
        typeText += event.key.toLowerCase();
        typeTimer = setTimeout(() => (typeText = ""), 650);
        if (active !== e) open(e);
        const found = options(e).findIndex((o) => enabled(o) && o.label.toLowerCase().startsWith(typeText));
        if (found >= 0) {
          index = found;
          highlight();
        }
      }
    };
    s.addEventListener("change", () => sync(e));
    sync(e);
  }
  function scan(root = document) {
    if (root.matches?.("select")) install(root);
    root.querySelectorAll?.("select").forEach(install);
  }
  scan();
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && !n.closest?.(".ce-picker-popup")) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(() => entries.forEach(sync), 120);
  document.addEventListener("pointerdown", (event) => {
    if (active && !popup.contains(event.target) && !active.wrap.contains(event.target)) close();
  });
  document.addEventListener("scroll", () => place(), true);
  addEventListener("resize", place);
  window.CausalPickers = {
    close,
    refresh() {
      scan();
      entries.forEach(sync);
    },
    inventory: () =>
      [...entries.values()].map((e) => ({
        id: e.select.id,
        button: e.button.id,
        hidden: e.select.hidden,
        disabled: e.select.disabled,
        value: e.select.value,
      })),
    state: () => ({
      id: active?.select.id || null,
      open: !popup.hidden,
      rect: popup.hidden ? null : popup.getBoundingClientRect().toJSON(),
      anchor: active?.button.getBoundingClientRect().toJSON(),
    }),
  };
})();
