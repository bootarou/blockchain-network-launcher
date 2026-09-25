const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function evaluate(source, requireModule = require) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(js, { exports, require: requireModule });
  return exports;
}
function dictionary(lang) {
  return evaluate(fs.readFileSync(path.join(__dirname, 'src/i18n', lang + '.ts'), 'utf8'))[lang];
}
const source = fs.readFileSync(path.join(__dirname, 'src/components/HelpPage.tsx'), 'utf8');
const ja = dictionary('ja'), en = dictionary('en');

test('Japanese and English help have the same keys with no duplicate definitions', () => {
  const keys = dict => Object.keys(dict).filter(k => k.startsWith('help.')).sort();
  assert.deepEqual(keys(ja), keys(en));
  for (const lang of ['ja', 'en']) {
    const code = fs.readFileSync(path.join(__dirname, 'src/i18n', lang + '.ts'), 'utf8');
    const tree = ts.createSourceFile(lang + '.ts', code, ts.ScriptTarget.Latest, true);
    const seen = new Set();
    const visit = node => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text.startsWith('help.')) {
        assert.ok(!seen.has(node.name.text), 'Duplicate: ' + node.name.text);
        seen.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
});

for (const [lang, dict] of [['ja', ja], ['en', en]]) {
  test(lang + ': render all help sections with resolved translations and live image presets', () => {
    const versions = [{ id: 'v3', symbolServerImage: 'test/server:current', symbolRestImage: 'test/rest:current' }];
    const { HelpPage } = evaluate(source, name => {
      if (name === '../i18n') return { useTranslation: () => ({ t: key => {
        assert.equal(typeof dict[key], 'string', 'Missing translation: ' + key);
        return dict[key];
      } }) };
      if (name === '../constants') return { CATAPULT_VERSIONS: versions };
      return require(name);
    });
    const html = renderToStaticMarkup(React.createElement(HelpPage));
    for (const id of ['quickstart', 'create-network', 'share-network', 'screens', 'join', 'buttons',
      'reset', 'certificates', 'backups', 'recovery', 'security', 'trouble', 'tech']) {
      assert.ok(html.includes(`id="${id}"`), 'Missing section: ' + id);
      assert.ok(html.includes(`href="#${id}"`), 'Missing TOC entry: ' + id);
    }
    assert.ok(html.includes('test/server:current'));
    assert.ok(html.includes('test/rest:current'));
    assert.ok(html.includes(dict['help.certIdentity']));
    assert.ok(html.includes(dict['help.resetSafety']));
    assert.ok(!html.includes('Docker-in-Docker (DinD)'));
  });
}
