const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Escapes user-controlled text (ticket subjects, device names, alert titles/
// bodies) before it's interpolated into an HTML email template - none of
// this app's email HTML is built with a templating engine that escapes by
// default, so every interpolation point has to call this explicitly.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
