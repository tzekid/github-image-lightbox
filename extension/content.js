(() => {
  "use strict";

  const ROOT_ID = "github-image-lightbox-root";

  // ---------------------------------------------------------------------------
  // GitHub markup knowledge. Everything that depends on GitHub's DOM lives here.
  // See README "Observed GitHub markup" for the evidence behind each rule.
  // ---------------------------------------------------------------------------

  // Rendered Markdown in issues, PRs, comments, READMEs and .md file views.
  const MARKDOWN_SELECTOR = ".markdown-body";

  // Repository files: href="/owner/repo/blob/<ref>/<path>", src="/owner/repo/raw/<ref>/<path>".
  const REPO_BLOB_PATH = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/;

  // The single <img> an anchor shows, or null if the anchor also carries text
  // or more than one image (those keep their normal link behavior).
  function soleImageOf(anchor) {
    const images = anchor.querySelectorAll("img");
    if (images.length !== 1) return null;
    if (anchor.textContent.trim() !== "") return null;
    return images[0];
  }

  // True when the anchor demonstrably points at the same asset the image shows.
  function linksToSameImage(anchor, image) {
    const href = anchor.href;
    // Uploaded attachments, Camo-proxied images and absolute image URLs:
    // GitHub links the image to its exact (possibly signed) source URL.
    if (href === image.currentSrc || href === image.src) return true;

    // Images committed to the repository.
    let link;
    let source;
    try {
      link = new URL(href);
      source = new URL(image.src);
    } catch {
      return false;
    }
    if (link.origin !== location.origin || source.origin !== location.origin) return false;
    const blob = link.pathname.match(REPO_BLOB_PATH);
    if (!blob) return false;
    const [, owner, repo, rest] = blob;
    return source.pathname === `/${owner}/${repo}/raw/${rest}`;
  }

  // ---------------------------------------------------------------------------
  // Click eligibility
  // ---------------------------------------------------------------------------

  function findCandidate(event) {
    if (event.defaultPrevented) return null;
    if (event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (target.closest(`#${ROOT_ID}`)) return null;
    if (target.closest("input, textarea, select, [contenteditable]")) return null;

    const anchor = target.closest("a[href]");
    if (!anchor || anchor.hasAttribute("download")) return null;
    if (!anchor.closest(MARKDOWN_SELECTOR)) return null;

    const image = soleImageOf(anchor);
    if (!image || !linksToSameImage(anchor, image)) return null;
    return { anchor, image };
  }

  // ---------------------------------------------------------------------------
  // Viewer
  // ---------------------------------------------------------------------------

  let viewer = null; // { dialog, stage, status, original, close }
  let opener = null; // anchor to refocus on close

  function buildViewer() {
    const dialog = document.createElement("dialog");
    dialog.id = ROOT_ID;
    dialog.setAttribute("aria-label", "Image preview");

    const toolbar = document.createElement("div");
    toolbar.className = "ghil-toolbar";

    const original = document.createElement("a");
    original.className = "ghil-button";
    original.target = "_blank";
    original.rel = "noopener noreferrer";
    original.textContent = "Open original link";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ghil-button";
    close.textContent = "Close";
    close.addEventListener("click", () => dialog.close());

    toolbar.append(original, close);

    const stage = document.createElement("div");
    stage.className = "ghil-stage";

    const status = document.createElement("p");
    status.className = "ghil-status";
    status.setAttribute("role", "status");

    stage.append(status);
    dialog.append(toolbar, stage);

    // Backdrop dismissal: only when both press and release land outside the
    // image and the toolbar, so dragging out of the image doesn't close it.
    let pressedOnBackdrop = false;
    const isBackdrop = (node) =>
      node instanceof Element && !node.closest(".ghil-image, .ghil-toolbar");
    dialog.addEventListener("pointerdown", (e) => {
      pressedOnBackdrop = isBackdrop(e.target);
    });
    dialog.addEventListener("click", (e) => {
      if (pressedOnBackdrop && isBackdrop(e.target)) dialog.close();
      pressedOnBackdrop = false;
    });

    dialog.addEventListener("close", onClose);

    (document.body || document.documentElement).append(dialog);
    return { dialog, stage, status, original, close };
  }

  function ensureViewer() {
    if (!viewer || !viewer.dialog.isConnected) viewer = buildViewer();
    return viewer;
  }

  function open(anchor, image) {
    const { dialog, stage, status, original, close } = ensureViewer();

    const preview = document.createElement("img");
    preview.className = "ghil-image";
    preview.alt = image.alt;
    preview.decoding = "async";
    preview.addEventListener("load", () => {
      status.textContent = "";
      dialog.dataset.state = "loaded";
    });
    preview.addEventListener("error", () => {
      status.textContent = "Couldn't load this preview.";
      dialog.dataset.state = "error";
    });

    stage.querySelector(".ghil-image")?.remove();
    stage.append(preview);
    original.href = anchor.href;
    status.textContent = "Loading…";
    dialog.dataset.state = "loading";
    opener = anchor;

    dialog.showModal();
    close.focus();
    // Display exactly what GitHub already selected for this image, signed
    // query parameters included; this usually hits the browser cache.
    preview.src = image.currentSrc || image.src;
  }

  function onClose() {
    if (!viewer) return;
    viewer.stage.querySelector(".ghil-image")?.remove();
    viewer.original.removeAttribute("href");
    viewer.status.textContent = "";
    delete viewer.dialog.dataset.state;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  function closeViewer() {
    if (viewer && viewer.dialog.open) viewer.dialog.close();
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function onDocumentClick(event) {
    const candidate = findCandidate(event);
    if (!candidate) return;
    ensureViewer();
    event.preventDefault();
    event.stopPropagation();
    open(candidate.anchor, candidate.image);
  }

  document.addEventListener("click", onDocumentClick, true);
  window.addEventListener("pagehide", closeViewer);
  window.addEventListener("popstate", closeViewer);
})();
