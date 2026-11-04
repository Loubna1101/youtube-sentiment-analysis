/* Content script : extrait les commentaires du DOM YouTube (page de lecture et Shorts exclus).
 * YouTube est une SPA : le script reste injecté lors des navigations, l'extraction se fait à la demande
 * (message envoyé par le popup), donc toujours sur le DOM courant. */
(() => {
  if (window.__ytSentimentLoaded) return;
  window.__ytSentimentLoaded = true;

  const THREAD = "ytd-comments ytd-comment-thread-renderer";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const videoId = () => new URLSearchParams(location.search).get("v");

  function countThreads() {
    return document.querySelectorAll(THREAD).length;
  }

  /** Extrait les commentaires actuellement présents dans le DOM. */
  function extract({ includeReplies = false } = {}) {
    const out = [];
    document.querySelectorAll(THREAD).forEach((thread) => {
      thread.querySelectorAll("#content-text").forEach((el) => {
        const isReply = !!el.closest("ytd-comment-replies-renderer");
        if (isReply && !includeReplies) return;
        const text = (el.innerText || el.textContent || "").trim();
        if (!text) return;
        const root = el.closest("ytd-comment-view-model, ytd-comment-renderer") || thread;
        const author = root.querySelector("#author-text")?.innerText?.trim() || "";
        out.push({ text, author, isReply });
      });
    });
    return out;
  }

  /** Défile pour déclencher le chargement paresseux jusqu'à `target` fils ou stagnation. */
  async function loadMore({ target = 200, includeReplies = false, onProgress } = {}) {
    const comments = document.querySelector("ytd-comments");
    if (!comments) return { loaded: 0 };
    comments.scrollIntoView({ block: "start" });
    let stagnant = 0;
    let last = countThreads();
    while (countThreads() < target && stagnant < 4) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
      await sleep(900);
      const now = countThreads();
      stagnant = now === last ? stagnant + 1 : 0;
      last = now;
      onProgress?.(now);
    }
    if (includeReplies) await expandReplies();
    return { loaded: countThreads() };
  }

  /** Déplie les fils de réponses (limité pour ne pas figer la page). */
  async function expandReplies(max = 60) {
    const buttons = [...document.querySelectorAll(
      `${THREAD} ytd-comment-replies-renderer #more-replies button, ${THREAD} ytd-comment-replies-renderer #more-replies-sub-thread button`
    )].slice(0, max);
    for (const b of buttons) {
      b.click();
      await sleep(250);
    }
    if (buttons.length) await sleep(800);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PING") {
      sendResponse({ ok: true });
    } else if (msg?.type === "EXTRACT") {
      sendResponse({
        ok: true,
        videoId: videoId(),
        title: document.title.replace(/ - YouTube$/, ""),
        comments: extract(msg.options),
        threads: countThreads(),
        commentsSectionFound: !!document.querySelector("ytd-comments"),
      });
    } else if (msg?.type === "LOAD_MORE") {
      loadMore(msg.options).then((r) => sendResponse({ ok: true, ...r }));
      return true; // réponse asynchrone
    }
  });
})();
