export const questionKey = (value) =>
  String(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function similarQuestion(a, b) {
  a = questionKey(a);
  b = questionKey(b);
  if (a === b) return true;
  const x = new Set(a.split(" ")),
    y = new Set(b.split(" "));
  if (Math.min(x.size, y.size) < 5) return false;
  return (
    [...x].filter((token) => y.has(token)).length / new Set([...x, ...y]).size >
    0.88
  );
}
// Deliberately small arithmetic grammar. Never evaluate model-supplied JavaScript.
export function arithmeticValue(expression) {
  const source = expression
    .replace(/×/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/−/g, "-")
    .replace(/,/g, ".")
    .replace(/\s/g, "");
  if (!/^[\d.+*/()^-]+$/.test(source) || source.length > 100)
    throw new Error("UNSUPPORTED");
  const tokens = source.match(/\d+(?:\.\d+)?|[.+*/()^-]/g) || [];
  let i = 0;
  function atom() {
    const t = tokens[i++];
    if (t === "(") {
      const v = sum();
      if (tokens[i++] !== ")") throw Error();
      return v;
    }
    if (!/^\d/.test(t || "")) throw Error();
    return Number(t);
  }
  function power() {
    let v = atom();
    if (tokens[i] === "^") {
      i++;
      v = v ** unary();
    }
    return v;
  }
  function unary() {
    if (tokens[i] === "-") {
      i++;
      return -unary();
    }
    if (tokens[i] === "+") {
      i++;
      return unary();
    }
    return power();
  }
  function product() {
    let v = unary();
    while (["*", "/"].includes(tokens[i])) {
      const op = tokens[i++],
        rhs = unary();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (["+", "-"].includes(tokens[i])) {
      const op = tokens[i++],
        rhs = product();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  const result = sum();
  if (i !== tokens.length || !Number.isFinite(result))
    throw Error("UNSUPPORTED");
  return result;
}
export function verifyQuestion(question, sourceText = "") {
  const expression = question.q
    .replace(/\$/g, "")
    .match(/^\s*([\d\s()+*/×÷.,^−-]+)\s*=\s*\?\s*$/)?.[1];
  let verification = "teacher_review";
  if (expression) {
    let expected;
    try {
      expected = arithmeticValue(expression);
    } catch {}
    if (expected !== undefined) {
      let actual;
      try {
        actual = arithmeticValue(question.opts[question.correct]);
      } catch {}
      if (actual === undefined || Math.abs(expected - actual) > 1e-9)
        throw new Error("INCORRECT_ARITHMETIC_KEY");
      verification = "computed";
    }
  }
  if (sourceText) {
    const quote = question.evidence;
    if (
      typeof quote !== "string" ||
      quote.trim().length < 8 ||
      !sourceText.normalize("NFKC").includes(quote.trim().normalize("NFKC"))
    )
      throw new Error("MISSING_SOURCE_EVIDENCE");
    verification = "source_quote";
  }
  return verification;
}
