(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const markLoaded = () => {
    document.body.classList.add("page-ready");

    if (prefersReducedMotion) {
      document.body.classList.add("loader-hidden");
      return;
    }

    window.setTimeout(() => {
      document.body.classList.add("loader-fade");
    }, 180);

    window.setTimeout(() => {
      document.body.classList.add("loader-hidden");
    }, 1150);
  };

  if (document.readyState === "complete") {
    markLoaded();
  } else {
    window.addEventListener("load", markLoaded, { once: true });
  }
})();
