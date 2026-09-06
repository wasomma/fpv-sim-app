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

  /**
   * An engine-overrides box, shared by Studies and Live Ops: the text is
   * checked against the engine's parameter table as it is typed (main's
   * validator, debounced), the collapsible parameter reference is built
   * from the same table on first open, and clicking one of its rows adds
   * that key at its default.
   *   overridesEditor({ textarea, status, ref, table, onResult? })
   * onResult(r) receives the validator's reply after every check —
   * { ok, keys } or { ok: false, issues } — and { ok, keys: 0 } for an
   * empty box. Returns { validate(), parse(), setStatus(text, cls) };
   * parse() turns the text into the object main expects ({ ok, value },
   * value undefined when the box is empty) or says why it cannot be sent
   * ({ ok: false, error }).
   */
  function overridesEditor(opts) {
    const textarea = node(opts.textarea);
    const status = node(opts.status);
    const ref = node(opts.ref);
    const table = node(opts.table);
    const onResult = typeof opts.onResult === "function" ? opts.onResult : () => {};
    const setStatus = (text, cls) => setLine(status, text, cls ? `note ${cls}` : "note");

    async function validate() {
      let r;
      if (textarea.value.trim() === "") {
        r = { ok: true, keys: 0 };
        textarea.classList.remove("invalid");
        setStatus("");
      } else {
        r = await window.fpvApp.studies.validateOverrides(textarea.value);
        if (r.ok) {
          textarea.classList.remove("invalid");
          setStatus(`${r.keys} override${r.keys === 1 ? "" : "s"} OK` + (r.warning ? ` · ${r.warning}` : ""), "ok");
        } else {
          textarea.classList.add("invalid");
          const first = r.issues[0];
          const more = r.issues.length > 1 ? ` · +${r.issues.length - 1} more` : "";
          setStatus(`${first.path}: ${first.message}${more}`, "bad");
        }
      }
      onResult(r);
      return r;
    }
    textarea.addEventListener("input", debounce(validate, 300));

    function parse() {
      const text = textarea.value.trim();
      if (text === "") return { ok: true, value: undefined };
      let value;
      try {
        value = JSON.parse(text);
      } catch (err) {
        return { ok: false, error: `overrides is not valid JSON: ${err.message}` };
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ok: false, error: "overrides must be a JSON object" };
      }
      return { ok: true, value };
    }

    // The parameter reference: the engine's own table, built on first open.
    let built = false;
    ref.addEventListener("toggle", async () => {
      if (!ref.open || built) return;
      built = true;
      const s = await window.fpvApp.studies.schema();
      if (!s.payload) {
        table.textContent = `parameter table unavailable — ${s.error || "engine schema not loaded"}`;
        return;
      }
      const t = document.createElement("table");
      const head = document.createElement("thead");
      head.innerHTML = "<tr><th>path</th><th>default</th><th>unit</th><th>range</th><th>meaning</th></tr>";
      t.appendChild(head);
      const body = document.createElement("tbody");
      for (const p of s.payload.parameters) {
        const tr = document.createElement("tr");
        tr.title = `add ${p.path} at its default`;
        const range = p.boolean ? "true / false" : p.range ? `${p.range[0]}–${p.range[1]}${p.integer ? " (integer)" : ""}` : "";
        for (const [i, text] of [p.path, String(p.default), p.unit || "", range, p.description].entries()) {
          const td = document.createElement("td");
          if (i === 0) {
            const c = document.createElement("code");
            c.textContent = text;
            td.appendChild(c);
          } else td.textContent = text;
          tr.appendChild(td);
        }
        tr.addEventListener("click", () => insert(p));
        body.appendChild(tr);
      }
      t.appendChild(body);
      table.appendChild(t);
      const foot = document.createElement("div");
      foot.className = "note";
      foot.style.marginTop = "6px";
      foot.textContent = "not overridable: " + s.payload.not_overridable.map((n) => `${n.path} — ${n.reason}`).join(" · ");
      table.appendChild(foot);
    });

    // Add one key at its default, keeping whatever is already typed.
    function insert(p) {
      if (textarea.disabled) return; // Live Ops locks the box while a session runs
      let obj = {};
      const text = textarea.value.trim();
      if (text !== "") {
        try {
          obj = JSON.parse(text);
        } catch {
          setStatus("fix the JSON syntax before adding keys", "bad");
          return;
        }
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) obj = {};
      }
      const parts = p.path.split(".");
      let cur = obj;
      for (const k of parts.slice(0, -1)) {
        if (typeof cur[k] !== "object" || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
        cur = cur[k];
      }
      const leaf = parts[parts.length - 1];
      if (!(leaf in cur)) cur[leaf] = p.default;
      textarea.value = JSON.stringify(obj);
      textarea.dispatchEvent(new Event("input", { bubbles: true })); // persists and validates
      textarea.focus();
    }

    return { validate, parse, setStatus };
  }

  window.app = { $, debounce, remember, copyButton, setLine, confirm, overridesEditor };
})();
