import { useEffect } from 'react';

function setMetaTag(name, content) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

// Sets the page <title> and meta description/robots tags for the current
// route — this is a CSR app with no server-rendering, so these only ever
// update after JS runs, but that's still what Google (and any other
// JS-executing crawler) sees, and it's what shows in the browser tab and
// link-preview cards for anything that does fetch the live page.
export default function useDocumentMeta(title, description, { noindex = false } = {}) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) setMetaTag('description', description);
    setMetaTag('robots', noindex ? 'noindex, nofollow' : 'index, follow');
  }, [title, description, noindex]);
}
