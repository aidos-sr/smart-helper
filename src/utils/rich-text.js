import 'katex/dist/katex.min.css';
import { esc } from './text.js';

const MATH_PATTERN = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\))/g;
const MATH_HINT = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\))/;

let katex = null;
const readyCallbacks = new Set();

// KaTeX is heavy (~250 kB), so it loads in a separate chunk after first paint.
const katexReady = import('katex')
  .then((module) => {
    katex = module.default;
    readyCallbacks.forEach((callback) => callback());
    readyCallbacks.clear();
  })
  .catch(() => {
    readyCallbacks.clear();
  });

export function hasMath(text) {
  return MATH_HINT.test(String(text ?? ''));
}

export function onMathReady(callback) {
  if (katex) callback();
  else readyCallbacks.add(callback);
  return katexReady;
}

function renderMath(expression, displayMode) {
  if (!katex) return `<code class="math-raw">${esc(expression)}</code>`;
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'html'
    });
  } catch {
    return `<code>${esc(expression)}</code>`;
  }
}

function inline(text) {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return out;
}

function markdownToHtml(text, mathItems) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let list = null;
  let paragraph = [];
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${paragraph.map(inline).join('<br>')}</p>`;
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += `</${list}>`;
    list = null;
  };

  for (const line of lines) {
    const fence = line.match(/^```[\w+-]*\s*$/);
    if (fence) {
      if (code) {
        html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
        code = null;
      } else {
        flushParagraph();
        closeList();
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const onlyMath = line.trim().match(/^%%MATH(\d+)%%$/);
    if (onlyMath && mathItems[Number(onlyMath[1])]?.display) {
      flushParagraph();
      closeList();
      html += mathItems[Number(onlyMath[1])].html;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(5, heading[1].length + 2);
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }

    const unordered = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextList = unordered ? 'ul' : 'ol';
      if (list && list !== nextList) closeList();
      if (!list) {
        list = nextList;
        html += `<${list}>`;
      }
      html += `<li>${inline((unordered || ordered)[1])}</li>`;
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html += '<hr>';
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      closeList();
      html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`;
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  if (code) html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
  flushParagraph();
  closeList();
  return html;
}

export function renderRichText(text) {
  const mathItems = [];
  const withTokens = String(text ?? '').replace(MATH_PATTERN, (match) => {
    let expression = match;
    let display = false;

    if (match.startsWith('$$')) {
      expression = match.slice(2, -2);
      display = true;
    } else if (match.startsWith('\\[')) {
      expression = match.slice(2, -2);
      display = true;
    } else if (match.startsWith('\\(')) {
      expression = match.slice(2, -2);
    } else {
      expression = match.slice(1, -1);
    }

    if (!expression.trim()) return match;
    mathItems.push({ html: renderMath(expression, display), display });
    return `%%MATH${mathItems.length - 1}%%`;
  });

  const html = markdownToHtml(withTokens, mathItems);
  return html.replace(/%%MATH(\d+)%%/g, (match, index) => {
    const item = mathItems[Number(index)];
    return item ? item.html : match;
  });
}
