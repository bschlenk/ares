import {app, BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {appContext, preferences, serviceHost} from '../dist/main.js';

app.whenReady().then(async () => {
  try {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (BrowserWindow.getAllWindows().length && serviceHost.info) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(serviceHost.info);
    assert.equal(app.getPath('userData'), appContext.runtimeRoot);
    assert.equal(serviceHost.instance, appContext.instanceId);
    const theme = preferences.catalog().entries.find(entry => entry.descriptor.id === 'presentation.theme');
    if (process.env.ARES_TEST_THEME) await preferences.set('presentation.theme', process.env.ARES_TEST_THEME);
    const status = await (await import('../dist/services/local-endpoint.js')).LocalServiceClient.named(process.env.ARES_SERVICE_DIR, appContext.sessionName ?? 'unused').manage({operation: 'app_status'}).catch(() => undefined);
    if (appContext.kind === 'named') { assert.equal(status.ready, true); assert.equal(status.instance, appContext.instanceId); }
    console.log('CONTEXT_READY ' + JSON.stringify({context: appContext, initialTheme: theme.value}));
  } catch (error) { console.error(error); app.exit(1); }
});
