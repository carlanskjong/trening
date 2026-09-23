  /* ================================================================
   * Start-up, and what happens when the router changes page.
   * ================================================================ */
  wireSettings();

  // Maps hold a WebGL context each and a phone allows only a few, so a page's
  // map is taken down when you leave that page and rebuilt when you return.
  window.pageShown = function (name) {
    if (name !== 'run') leaveRun();
    if (window.mapPage) { if (name === 'map') mapPage.show(); else mapPage.hide(); }
    if (window.planPage && (name === 'plan' || name === 'home')) planPage.refresh();
  };
