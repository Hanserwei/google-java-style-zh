(() => {
  'use strict';

  const guide = document.getElementById('guide');
  if (!guide) return;
  const panel = document.getElementById('chapter-panel');
  const nav = document.getElementById('chapter-nav');
  const search = document.getElementById('guide-search');
  const results = document.getElementById('search-results');
  const searchStatus = document.getElementById('search-status');
  const actionStatus = document.getElementById('action-status');
  const menuButton = document.querySelector('.menu-toggle');
  const closeButton = document.querySelector('.menu-close');
  const backdrop = document.querySelector('.menu-backdrop');
  const mobile = window.matchMedia('(max-width: 820px)');
  const topbar = document.querySelector('.topbar');
  const main = document.getElementById('main-content');
  const themeButton = document.querySelector('.theme-toggle');
  let sequence = 0;
  let lastFocus = null;
  let menuOpen = false;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const ensureId = (node) => {
    if (!node.id) {
      let id;
      do { id = `reader-section-${++sequence}`; } while (document.getElementById(id));
      node.id = id;
    }
    return node.id;
  };
  const fragment = (id) => `#${encodeURIComponent(id)}`;
  const headings = [...guide.querySelectorAll('h2, h3, h4, h5, h6')];
  const titles = new Map(headings.map((heading) => [heading, heading.textContent.trim()]));
  headings.forEach((heading) => {
    const id = ensureId(heading);
    const link = make('a', 'heading-link', '#');
    link.href = fragment(id);
    link.setAttribute('aria-label', `链接到：${titles.get(heading)}`);
    heading.append(link);
  });

  const tocHeadings = headings.filter((heading) => heading.matches('h2, h3'));
  const chapterList = make('ol', 'chapter-list');
  const tocEntries = [];
  const chapterGroups = [];
  let group;
  tocHeadings.forEach((heading) => {
    const title = titles.get(heading);
    const link = make('a', '', title);
    link.href = fragment(heading.id);
    if (heading.tagName === 'H2' || !group) {
      const item = make('li', 'chapter-item');
      const row = make('div', 'chapter-row');
      const children = make('ol', 'section-list');
      ensureId(children);
      const toggle = make('button', 'chapter-toggle');
      toggle.type = 'button';
      toggle.append(make('span', '', '›'));
      toggle.firstChild.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-controls', children.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', `展开或收起：${title}`);
      children.hidden = true;
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        children.hidden = expanded;
      });
      row.append(link, toggle);
      item.append(row, children);
      chapterList.append(item);
      group = { children, toggle };
      chapterGroups.push(group);
    } else {
      const item = make('li');
      item.append(link);
      group.children.append(item);
    }
    tocEntries.push({ heading, link, group });
  });
  chapterGroups.forEach(({ children, toggle }) => { toggle.hidden = !children.children.length; });
  nav.replaceChildren(chapterList);

  const setMenu = (open, restore = true) => {
    open = open && mobile.matches;
    if (open === menuOpen) return;
    menuOpen = open;
    if (open) lastFocus = document.activeElement;
    document.body.classList.toggle('menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
    if (open) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      topbar.inert = true;
      main.inert = true;
      closeButton.focus();
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      topbar.inert = false;
      main.inert = false;
      if (restore && lastFocus?.isConnected) lastFocus.focus();
    }
  };
  const syncMobile = () => {
    menuButton.hidden = !mobile.matches;
    closeButton.hidden = !mobile.matches;
    if (!mobile.matches) setMenu(false, false);
    // A breakpoint change must never leave focus inside an invisible panel.
    if (mobile.matches && !menuOpen && panel.contains(document.activeElement)) menuButton.focus();
  };
  menuButton.addEventListener('click', () => setMenu(!menuOpen));
  closeButton.addEventListener('click', () => setMenu(false));
  backdrop.addEventListener('click', () => setMenu(false));
  mobile.addEventListener('change', syncMobile);
  syncMobile();
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (mobile.matches) setMenu(true);
      search.focus();
      search.select();
      return;
    }
    if (event.key === 'Escape') {
      if (menuOpen) { event.preventDefault(); setMenu(false); }
      else if (search.value && panel.contains(document.activeElement)) {
        search.value = '';
        renderSearch();
        search.focus();
      }
    }
    if (!menuOpen || event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('a[href], button, input, [tabindex="0"]')]
      .filter((node) => !node.disabled && node.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });

  const focusTarget = (target) => {
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
    target.focus({ preventScroll: true });
  };
  // Keep native hash/history behavior, and place keyboard focus at the destination.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let id;
    try { id = decodeURIComponent(link.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    if (menuOpen) setMenu(false, false);
    requestAnimationFrame(() => focusTarget(target));
  });

  // Index text before adding controls, so search never matches UI labels.
  let context = '规范正文';
  const searchIndex = [...guide.querySelectorAll('h2, h3, h4, h5, h6, p, li, pre, td, th, dt, dd')]
    .filter((node) => !node.matches('li, td, th, dd') || !node.querySelector('p, li, pre, dd'))
    .map((node) => {
      const text = titles.get(node) || node.textContent.replace(/\s+/g, ' ').trim();
      if (titles.has(node)) context = text;
      ensureId(node);
      return { node, text, normalized: text.toLocaleLowerCase(), title: context };
    }).filter((entry) => entry.text);
  const highlight = (text, terms) => {
    const output = document.createDocumentFragment();
    const lower = text.toLocaleLowerCase();
    let cursor = 0;
    while (cursor < text.length) {
      let next = -1;
      let length = 0;
      terms.forEach((term) => {
        const position = lower.indexOf(term, cursor);
        if (position !== -1 && (next === -1 || position < next)) { next = position; length = term.length; }
      });
      if (next === -1) { output.append(document.createTextNode(text.slice(cursor))); break; }
      output.append(document.createTextNode(text.slice(cursor, next)), make('mark', '', text.slice(next, next + length)));
      cursor = next + length;
    }
    return output;
  };
  function renderSearch() {
    const query = search.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    results.hidden = !query;
    nav.hidden = !!query;
    if (!query) { searchStatus.textContent = ''; return; }
    const terms = [...new Set(query.split(/\s+/).filter(Boolean))];
    const matches = searchIndex.filter((entry) => terms.every((term) => entry.normalized.includes(term)));
    searchStatus.textContent = matches.length ? `找到 ${matches.length} 条结果。选择结果可跳至原文。` : '未找到匹配内容，请尝试其他关键词。';
    const batch = document.createDocumentFragment();
    matches.forEach((entry) => {
      const firstMatch = Math.min(...terms.map((term) => entry.normalized.indexOf(term)));
      const start = Math.max(0, firstMatch - 35);
      const end = Math.min(entry.text.length, start + 160);
      const excerpt = `${start ? '…' : ''}${entry.text.slice(start, end)}${end < entry.text.length ? '…' : ''}`;
      const item = make('li');
      const link = make('a');
      link.href = fragment(ensureId(entry.node));
      const title = make('span', 'result-title', entry.title);
      const description = make('span', 'result-excerpt');
      description.append(highlight(excerpt, terms));
      link.append(title, description);
      item.append(link);
      batch.append(item);
    });
    results.append(batch);
  }
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 140);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      const first = results.querySelector('a');
      if (first) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Enter') {
      clearTimeout(searchTimer);
      renderSearch();
      results.querySelector('a')?.focus();
    }
  });

  guide.querySelectorAll('pre').forEach((pre) => {
    const text = pre.textContent;
    const wrapper = make('div', 'code-block');
    pre.before(wrapper);
    wrapper.append(pre);
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', '代码示例，可横向滚动');
    const button = make('button', 'copy-code', '复制代码');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); copied = true; } catch { /* Try local-file fallback. */ }
      }
      if (!copied) {
        const field = make('textarea');
        field.value = text;
        field.setAttribute('aria-label', '待复制的代码');
        field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        wrapper.append(field);
        field.select();
        try { copied = document.execCommand('copy'); } catch { copied = false; }
        field.remove();
        button.disabled = false;
        button.focus({ preventScroll: true });
      }
      button.disabled = false;
      button.textContent = copied ? '已复制' : '复制失败';
      actionStatus.textContent = copied ? '代码已复制到剪贴板。' : '无法访问剪贴板，请选中代码后手动复制。';
      setTimeout(() => { button.textContent = '复制代码'; }, 2200);
    });
    wrapper.append(button);
  });
  guide.querySelectorAll('table').forEach((table, index) => {
    const wrapper = make('div', 'table-scroll');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', table.caption?.textContent.trim() || `表格 ${index + 1}，可横向滚动`);
    table.before(wrapper);
    wrapper.append(table);
  });

  const progress = document.getElementById('reading-progress');
  const percent = document.getElementById('reading-percent');
  const progressFill = document.getElementById('top-progress-fill');
  const backToTop = document.querySelector('.back-to-top');
  let currentEntry;
  let framePending = false;
  function updateReading() {
    framePending = false;
    const offset = topbar.getBoundingClientRect().height + 28;
    const rect = guide.getBoundingClientRect();
    const available = Math.max(1, rect.height - window.innerHeight + offset);
    let value = Math.round(Math.max(0, Math.min(1, (offset - rect.top) / available)) * 100);
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) value = 100;
    progress.value = value;
    progress.textContent = `${value}%`;
    percent.textContent = `${value}%`;
    progressFill.style.width = `${value}%`;
    backToTop.hidden = window.scrollY < 450;
    let active = tocEntries[0];
    for (const entry of tocEntries) {
      if (entry.heading.getBoundingClientRect().top <= offset + 20) active = entry;
      else break;
    }
    if (active && active !== currentEntry) {
      currentEntry?.link.removeAttribute('aria-current');
      active.link.setAttribute('aria-current', 'location');
      if (active.group.children.children.length) {
        active.group.children.hidden = false;
        active.group.toggle.setAttribute('aria-expanded', 'true');
      }
      currentEntry = active;
    }
  }
  const scheduleReading = () => {
    if (!framePending) { framePending = true; requestAnimationFrame(updateReading); }
  };
  window.addEventListener('scroll', scheduleReading, { passive: true });
  window.addEventListener('resize', scheduleReading);
  window.addEventListener('hashchange', scheduleReading);
  if ('ResizeObserver' in window) new ResizeObserver(scheduleReading).observe(guide);
  updateReading();

  const darkPreference = window.matchMedia('(prefers-color-scheme: dark)');
  let chosenTheme = null;
  try { chosenTheme = localStorage.getItem('java-guide-theme'); } catch { /* Storage may be unavailable. */ }
  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
    themeButton.textContent = dark ? '浅色' : '深色';
  };
  applyTheme(chosenTheme === 'dark' || chosenTheme === 'light' ? chosenTheme : (darkPreference.matches ? 'dark' : 'light'));
  themeButton.hidden = false;
  themeButton.addEventListener('click', () => {
    chosenTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(chosenTheme);
    try { localStorage.setItem('java-guide-theme', chosenTheme); } catch { /* Keep the session preference. */ }
  });
  darkPreference.addEventListener('change', () => {
    if (!chosenTheme) applyTheme(darkPreference.matches ? 'dark' : 'light');
  });
})();
