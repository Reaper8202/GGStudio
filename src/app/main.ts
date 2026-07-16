import '../style.css';

async function boot(): Promise<void> {
  const el = document.getElementById('app');
  if (!el) throw new Error('missing #app');
  const { App } = await import('./App.ts');
  const app = new App(el);
  await app.start();
  const params = new URLSearchParams(location.search);
  if (params.get('debug') === '1') {
    (window as unknown as { __scrapRig: unknown }).__scrapRig = app.debugSeam();
  }
}

void boot();
