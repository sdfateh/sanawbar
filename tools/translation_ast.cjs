/* Read-only JS/JSX translation extraction using the caller's existing parser. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const requireFrom = createRequire(path.join(path.resolve(request.node_modules), '__coverage__.cjs'));
const parser = requireFrom('@babel/parser');
const result = { keys: [], dynamic: [], unwrapped: [], errors: [] };
const display = (value) => /[A-Za-z\u0600-\u06ff]/.test(value || '');
for (const file of request.files) {
  const source = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx', ...( /\.tsx?$/.test(file) ? ['typescript'] : [])] });
  } catch (error) {
    result.errors.push({ location: `${file}:${error.loc?.line || 1}`, error: error.message });
    continue;
  }
  const emit = (bucket, node, value) => result[bucket].push({ location: `${file}:${node.loc.start.line}`, value });
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const name = node.callee?.type === 'Identifier' ? node.callee.name :
        node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'frappe' ? node.callee.property?.name : null;
      if (['__', 'translate', '_'].includes(name)) {
        const argument = node.arguments[0];
        const context = node.arguments[2];
        const contextualize = (value) => {
          if (context?.type === 'StringLiteral' && context.value) return `${value}:${context.value}`;
          if (context && context.type !== 'NullLiteral') emit('dynamic', node, `context=${source.slice(context.start, context.end)}`);
          return value;
        };
        if (argument?.type === 'StringLiteral') emit('keys', node, contextualize(argument.value.trim()));
        else if (argument?.type === 'TemplateLiteral' && argument.expressions.length === 0)
          emit('keys', node, contextualize(argument.quasis[0].value.cooked.trim()));
        else emit('dynamic', node, argument ? source.slice(argument.start, argument.end) : '<missing argument>');
      }
    }
    if (node.type === 'JSXText') {
      const value = node.value.replace(/\s+/g, ' ').trim();
      if (display(value)) emit('unwrapped', node, value);
    }
    if (node.type === 'JSXAttribute' && ['title', 'placeholder', 'aria-label', 'alt', 'label', 'description', 'emptyMessage'].includes(node.name?.name)) {
      if (node.value?.type === 'StringLiteral' && display(node.value.value)) emit('unwrapped', node, node.value.value);
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  }
  walk(ast);
}
process.stdout.write(JSON.stringify(result));
