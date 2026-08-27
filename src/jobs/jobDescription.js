const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A']);

// Provider descriptions are untrusted HTML. Keep useful formatting while removing
// scripts, inline styles, and navigation attributes before rendering in the UI.
export function sanitizeJobDescription(value) {
  const source = String(value || '');
  if (!source.trim()) return '';
  if (typeof DOMParser === 'undefined') return source.replace(/<[^>]*>/g, '');
  const document = new DOMParser().parseFromString(source, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed, form').forEach((node) => node.remove());
  document.body.querySelectorAll('*').forEach((node) => {
    if (!ALLOWED_TAGS.has(node.tagName)) {
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));
    if (node.tagName === 'A') node.replaceWith(...Array.from(node.childNodes));
  });
  return document.body.innerHTML;
}
