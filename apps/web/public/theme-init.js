// Aplica el tema guardado antes de pintar, para que no parpadee.
// Vive en un archivo propio (y no en línea en index.html) para que la CSP pueda prohibir scripts en línea.
try {
  var t = localStorage.getItem("tjt-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
