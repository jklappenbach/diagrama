// JCEF host bridge: the JVM calls window.diagrama.setContent(text, file) on edit;
// a drag in the preview calls window.__diagramaPersist(newText) (injected by the JVM).
window.diagrama = {
  ctl: null,
  setContent: function (text, fileName) {
    var stage = document.getElementById('stage');
    if (this.ctl) { try { this.ctl.destroy(); } catch (e) { /* ignore */ } }
    try {
      this.ctl = Diagrama.renderKdl(text, stage, {
        onPersist: function (newText) {
          if (window.__diagramaPersist) window.__diagramaPersist(newText);
        }
      });
    } catch (e) {
      stage.innerHTML = '<pre style="color:#b00020;padding:12px;font:13px monospace;white-space:pre-wrap">'
        + String((e && e.message) || e) + '</pre>';
    }
  }
};
