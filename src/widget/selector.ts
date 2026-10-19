const escape = (value: string) => CSS.escape(value);

/** A short CSS selector for `element`, stable enough to find it again. */
export function describeElement(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;

  while (node && node !== document.documentElement && parts.length < 5) {
    const testId = node.getAttribute("data-testid");
    if (node.id) {
      parts.unshift(`#${escape(node.id)}`);
      break;
    }
    if (testId) {
      parts.unshift(`[data-testid="${testId}"]`);
      break;
    }

    let part = node.tagName.toLowerCase();
    // <body> is one per page: its (often framework-generated) classes say nothing
    if (node !== document.body) {
      const classes = [...node.classList]
        .slice(0, 2)
        .map((c) => `.${escape(c)}`);
      part += classes.join("");
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter(
        (child) => child.tagName === node!.tagName,
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ") || "html";
}
