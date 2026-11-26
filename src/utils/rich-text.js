import { esc } from "./text.js";

const MATH_PATTERN =
  /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\))/g;
const MATH_HINT =
  /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\))/;

let katex = null;
const readyCallbacks = new Set();

let katexReady;
function loadMath() {
  return (katexReady ||= Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ])
    .then(([module]) => {
      katex = module.default;
      for (const callback of readyCallbacks) callback();
      readyCallbacks.clear();
    })
    .catch(() => {
      katexReady = null;
      readyCallbacks.clear();
    }));
}

export function hasMath(text) {
  return MATH_HINT.test(
    String(text ?? "").replace(
      /```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]]*\]\([^)]*\)|\\\$/g,
      "",
    ),
  );
}

export function onMathReady(callback) {
  if (katex) callback();
  else readyCallbacks.add(callback);
  return loadMath();
}

function renderMath(expression, displayMode) {
  if (!katex) {
    loadMath();
    return `<code class="math-raw">${esc(expression)}</code>`;
  }
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: "html",
    });
  } catch {
    return `<code>${esc(expression)}</code>`;
  }
}

function inline(text) {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return out;
}

function markdownToHtml(text, mathItems, mathPrefix) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let html = "";
  let list = null;
  let paragraph = [];
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${paragraph.map(inline).join("<br>")}</p>`;
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += `</${list}>`;
    list = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (
      !code &&
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}/.test(lines[lineIndex + 1] || "")
    ) {
      flushParagraph();
      closeList();
      const cells = (row) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const headers = cells(line);
      html +=
        '<div class="table-scroll"><table><thead><tr>' +
        headers.map((c) => `<th scope="col">${inline(c)}</th>`).join("") +
        "</tr></thead><tbody>";
      lineIndex++;
      while (lines[lineIndex + 1]?.includes("|")) {
        lineIndex++;
        html +=
          "<tr>" +
          cells(lines[lineIndex])
            .map((c) => `<td>${inline(c)}</td>`)
            .join("") +
          "</tr>";
      }
      html += "</tbody></table></div>";
      continue;
    }
    const fence = line.match(/^```[\w+-]*\s*$/);
    if (fence) {
      if (code) {
        html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
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

    const onlyMath = line
      .trim()
      .match(new RegExp("^" + mathPrefix + "([0-9]+)END$"));
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
      const nextList = unordered ? "ul" : "ol";
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
      html += "<hr>";
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      closeList();
      html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`;
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  if (code) html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
  flushParagraph();
  closeList();
  return html;
}

export function renderRichText(text) {
  const mathItems = [];
  const source = String(text ?? "");
  const mathPrefix = "SHMATH" + Math.random().toString(36).slice(2) + "TOKEN";
  const protectedParts = [];
  const prefix = "SHCODE" + Math.random().toString(36).slice(2) + "TOKEN";
  const protectedText = source.replace(
    /(```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]+`|\[[^\]]*\]\([^\s)]*\)|\\\$)/g,
    (match) => {
      protectedParts.push(match);
      return prefix + (protectedParts.length - 1) + "END";
    },
  );
  const withTokens = protectedText.replace(MATH_PATTERN, (match) => {
    let expression = match;
    let display = false;

    if (match.startsWith("$$")) {
      expression = match.slice(2, -2);
      display = true;
    } else if (match.startsWith("\\[")) {
      expression = match.slice(2, -2);
      display = true;
    } else if (match.startsWith("\\(")) {
      expression = match.slice(2, -2);
    } else {
      expression = match.slice(1, -1);
    }

    if (
      !expression.trim() ||
      /^\d+(?:[.,]\d+)?\s+(?:and|и|және)\b/.test(expression)
    )
      return match;
    mathItems.push({ html: renderMath(expression, display), display });
    return mathPrefix + (mathItems.length - 1) + "END";
  });

  const restored = withTokens.replace(
    new RegExp(prefix + "([0-9]+)END", "g"),
    (_, index) => protectedParts[Number(index)],
  );
  const html = markdownToHtml(restored, mathItems, mathPrefix);
  return html.replace(
    new RegExp(mathPrefix + "([0-9]+)END", "g"),
    (match, index) => {
      const item = mathItems[Number(index)];
      return item ? item.html : match;
    },
  );
}
