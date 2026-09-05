/*
 * Shared helpers for the app's own panels. A classic script (the pages'
 * CSP allows 'self' scripts) that exposes window.app; it depends on the
 * contextBridge API window.fpvApp installed by the preload.
 */
(() => {
  const $ = (id) => document.getElementById(id);

  const debounce = (fn, ms) => {
    let t = null;
    return (...args) => {
      if (t !== null) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn(...args);
      }, ms);
    };
  };

  const node = (ref) => (typeof ref === "string" ? $(ref) : ref);

  function readField(el, type) {
    if (type === "bool") return el.checked === true;
    if (type === "int" || type === "num") {
      const s = String(el.value).trim();
      if (s === "") return null;
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      return type === "int" ? Math.trunc(n) : n;
    }
    return String(el.value);
  }

  function writeField(el, type, v) {
    if (v === null || v === undefined) return false;
    if (type === "bool") {
      if (typeof v !== "boolean") return false;
      el.checked = v;
      return true;
    }
    if (type === "int" || type === "num") {
      if (typeof v !== "number" || !Number.isFinite(v)) return false;
      el.value = String(v);
      return true;
    }
    if (typeof v !== "string") return false;
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) return false;
    el.value = v;
    return true;
  }

  /**
   * Restore a group of fields from the persisted `ui` bag and write them
   * back (debounced) as the user edits.
   *   spec = { name: { el: id | element, type?: "str"|"int"|"num"|"bool", manual?: boolean } }
   * `manual` fields are restored on load but persisted only when the page
   * calls commit(name) — for text that must not be remembered until it was
   * accepted (the gateway JSON is committed on a successful STAGE).
   * Resolves after the restore so pages can sequence on it.
   */
  async function remember(key, spec) {
    const fields = [];
    for (const [name, s] of Object.entries(spec)) {
      const el = node(s.el);
      if (el) fields.push({ name, el, type: s.type || "str", manual: s.manual === true });
    }
    const held = {};
    let saved = null;
    try {
      saved = await window.fpvApp.ui.get(key);
    } catch {
      saved = null;
    }
    if (saved !== null && typeof saved === "object") {
      for (const f of fields) {
        if (writeField(f.el, f.type, saved[f.name]) && f.manual) held[f.name] = saved[f.name];
      }
    }
    const snapshot = () => {
      const out = {};
      for (const f of fields) {
        out[f.name] = f.manual ? (f.name in held ? held[f.name] : null) : readField(f.el, f.type);
      }
      return out;
    };
    const persist = debounce(() => {
      window.fpvApp.ui.set(key, snapshot()).catch(() => {});
    }, 300);
    for (const f of fields) {
      if (f.manual) continue;
      f.el.addEventListener("input", persist);
      f.el.addEventListener("change", persist);
    }
    return {
      saved,
      persist,
      commit(name) {
        const f = fields.find((x) => x.name === name);
        if (!f) return;
        held[name] = readField(f.el, f.type);
        persist();
      },
    };
  }

  /** Wire a button to copy getText() with COPIED / COPY FAILED feedback. */
  function copyButton(btn, getText) {
    const idle = btn.textContent;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(getText()));
        btn.textContent = "COPIED";
      } catch {
        btn.textContent = "COPY FAILED";
      }
      setTimeout(() => (btn.textContent = idle), 1200);
    });
  }

  /** Set a status line's text and class in one go. */
  function setLine(el, text, cls) {
    el.textContent = text;
    el.className = cls || "";
  }

  /**
   * Native confirm dialog via main (added to the bridge in a later phase);
   * resolves true when the bridge has no confirm, so pages degrade to
   * "just do it" rather than to "never do it".
   */
  async function confirm(opts) {
    const ui = window.fpvApp && window.fpvApp.ui;
    if (!ui || typeof ui.confirm !== "function") return true;
    try {
      return (await ui.confirm(opts)) === true;
    } catch {
      return false;
    }
  }

  window.app = { $, debounce, remember, copyButton, setLine, confirm };
})();
