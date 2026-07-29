import '../ui/ui-system.css';
import '../style.css';

async function boot(): Promise<void> {
  const el = document.getElementById('app');
  if (!el) throw new Error('missing #app');

  const isMuseumPath = /^\/dev\/ui\/?$/.test(location.pathname);
  if (isMuseumPath) {
    if (!import.meta.env.DEV) {
      document.title = 'Not found';
      el.innerHTML =
        '<main class="dev-route-unavailable"><span>404</span><p>Nothing lives here.</p></main>';
      return;
    }
    const { mountUIMuseum } = await import('../ui/Museum.ts');
    mountUIMuseum(el);
    return;
  }

  const { App } = await import('./App.ts');
  const app = new App(el);
  await app.start();

  // Read every parameter before rewriting the URL below, so stripping the
  // share code cannot take the debug seam down with it.
  const params = new URLSearchParams(location.search);
  const build = params.get('build');
  if (params.get('debug') === '1') {
    (window as unknown as { __scrapRig: unknown }).__scrapRig = app.debugSeam();
  }
  if (build) {
    // Drop only `build`, keeping any other parameters, so a refresh or a back
    // navigation does not import the same rig again.
    params.delete('build');
    const query = params.toString();
    history.replaceState(
      null,
      '',
      `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
    );
    void app.importBuildCode(build);
  }
}

void boot();
