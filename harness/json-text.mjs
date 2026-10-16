const primitive = String.raw`(?:"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null)`;
const expandedArray = new RegExp(String.raw`^( *)((?:"(?:[^"\\]|\\.)*": )?)\[\n((?: *${primitive},?\n)+) *\](,?)$`, 'gm');
const plainText = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** JSON as Prettier writes it: two-space indent, and an array of plain values on one line when it fits in 80 columns. */
export function prettierJson(value) {
  return plainText(value).replace(expandedArray, (whole, indent, key, items, comma) => {
    const inline = `${indent}${key}[${items.trim().split('\n').map((item) => item.trim().replace(/,$/, '')).join(', ')}]${comma}`;
    return inline.length <= 80 ? inline : whole;
  });
}

/**
 * `value` as JSON in the style of the file it replaces, so rewriting feature_list.json to change one status
 * is a one-line diff instead of a reformatted file in the commit and the PR.
 */
export function jsonLike(original, value) {
  return original.trimEnd() === plainText(JSON.parse(original)).trimEnd() ? plainText(value) : prettierJson(value);
}
