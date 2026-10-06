const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, 'upload-timeout.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports: exportsObject });

test('Vite proxies a continuous upload with the extended incoming deadline', async () => {
  const { createServer } = await import('vite');
  const backend = http.createServer((req, res) => {
    let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; });
    req.on('end', () => { res.writeHead(202); res.end(String(bytes)); });
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  let vite;
  try {
    vite = await createServer({ configFile: false, plugins: [exportsObject.uploadTimeout()],
      server: { host: '127.0.0.1', port: 0, hmr: false, proxy: {
        '/api': { target: `http://127.0.0.1:${backend.address().port}` },
      } },
    });
    await vite.listen();
    assert.equal(vite.httpServer.requestTimeout, 86400000);
    // Set BNL_LONG_UPLOAD_TEST=1 to exercise the original 300-second boundary.
    const duration = process.env.BNL_LONG_UPLOAD_TEST === '1' ? 310000 : 1200;
    const result = await new Promise((resolve, reject) => {
      let bytes = 0;
      const req = http.request({ host: '127.0.0.1', port: vite.httpServer.address().port,
        path: '/api/fast-sync', method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
      }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body, bytes }));
      });
      const write = () => { req.write(Buffer.alloc(1024)); bytes += 1024; };
      const interval = setInterval(write, 200);
      const end = setTimeout(() => { clearInterval(interval); req.end(); }, duration);
      req.on('error', reject);
      req.on('close', () => { clearInterval(interval); clearTimeout(end); });
      write();
    });
    assert.equal(result.status, 202);
    assert.equal(Number(result.body), result.bytes);
  } finally {
    if (vite) await vite.close();
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
  }
});

test('preview uses the same deadline; middleware mode without HTTP server is supported', () => {
  const plugin = exportsObject.uploadTimeout();
  const server = { httpServer: { requestTimeout: 300000 } };
  plugin.configurePreviewServer(server);
  assert.equal(server.httpServer.requestTimeout, 86400000);
  plugin.configureServer({ httpServer: null });
});
