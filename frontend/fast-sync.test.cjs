const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function evaluate(file, requireModule = require) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: requireModule });
  return exports;
}
const ja = evaluate('src/i18n/ja.ts').ja, en = evaluate('src/i18n/en.ts').en;
test('Fast Sync translations have matching keys', () => {
  const keys = d => Object.keys(d).filter(k => k.startsWith('fastSync.')).sort();
  assert.deepEqual(keys(ja), keys(en));
});
for (const [lang, dict] of [['ja', ja], ['en', en]]) {
  test(lang + ': new-node, busy, ready, failed and manual states render without enabling unsafe actions', () => {
    for (const state of [null, 'uploading', 'extracting', 'ready', 'failed', 'manual', 'complete']) {
      let calls = 0;
      const status = { available: state === null, reason: '', job: state ? { state, height: '148874', files: 20, bytes: 2000 } : null };
      const { FastSyncPanel } = evaluate('src/components/FastSyncPanel.tsx', name => {
        if (name === 'react') return { ...React, useEffect: () => {}, useState: initial => [calls++ === 0 ? status : initial, () => {}] };
        if (name === '../lib/api') return { api: {} };
        if (name === '../i18n') return { useTranslation: () => ({ t: key => { assert.equal(typeof dict[key], 'string', key); return dict[key]; } }) };
        return require(name);
      });
      const html = renderToStaticMarkup(React.createElement(FastSyncPanel));
      assert.ok(html.includes('fast-sync-title'));
      if (state === null) { assert.match(html, /type="file"/); assert.match(html, /disabled=""/); }
      else assert.ok(!html.includes('type="file"'));
      if (state === 'manual') { assert.ok(html.includes('shared/fast-sync.json')); assert.ok(!html.includes('<button')); }
      if (state === 'ready' || state === 'failed') assert.ok(html.includes(dict['fastSync.discard']));
    }
  });
}
