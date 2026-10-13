"use strict";

/* Storage in this browser. Every read and write may fail (a private window,
   blocked site data, an artifact preview), so each call sits in try/catch
   and the app works fully without storage.

     pulmapaja.play.<puzzle-only code>  {progress, type, level, elapsed, done, filled, total, updated}
     pulmapaja.play.index               puzzle codes, most recent first, at most 20
     pulmapaja.play.last                the puzzle opened last
     pulmapaja.recent                   type ids last created or opened, in either
                                        mode, most recent first, at most 4: the
                                        type picker's "Viimeksi käytetyt" */

const PlayStore = (() => {
  const PREFIX = "pulmapaja.play.", INDEX = PREFIX + "index", LAST = PREFIX + "last", MAX = 20;
  const RECENT = "pulmapaja.recent", MAX_RECENT = 4;

  const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const del = k => { try { localStorage.removeItem(k); } catch {} };
  const index = () => { const x = get(INDEX); return Array.isArray(x) ? x : []; };

  return {
    record: id => get(PREFIX + id),

    /* Stores the record, moves it to the front of the index and drops the
       records that fall off the end. */
    save(id, rec) {
      if (!set(PREFIX + id, rec)) return false;
      const idx = [id, ...index().filter(x => x !== id)];
      for (const old of idx.slice(MAX)) del(PREFIX + old);
      set(INDEX, idx.slice(0, MAX));
      set(LAST, id);
      return true;
    },

    remove(id) {
      del(PREFIX + id);
      set(INDEX, index().filter(x => x !== id));
    },

    /* [id, record] pairs, most recent first */
    list: () => index().map(id => [id, get(PREFIX + id)]).filter(([, r]) => r && typeof r === "object"),

    last: () => get(LAST),

    recent() {
      const x = get(RECENT);
      return Array.isArray(x) ? x.filter(t => typeof t === "string").slice(0, MAX_RECENT) : [];
    },

    touchRecent(type) {
      set(RECENT, [type, ...PlayStore.recent().filter(t => t !== type)].slice(0, MAX_RECENT));
    }
  };
})();
