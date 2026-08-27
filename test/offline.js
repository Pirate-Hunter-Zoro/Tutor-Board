// A board that is not there must still paint something.
//
// The address the installed app has baked into it is served by whichever
// machine currently holds the board, and on a cluster that machine's allocation
// ends. Open the app after that and every request fails. The worker's fallback
// was `caches.match(req)` and then `caches.match("/")` -- and when neither is in
// the cache that resolves to `undefined`, which `respondWith` treats as a
// network error, which paints a blank white screen. Nothing on it says what
// happened, there is no way to retry from inside a standalone app, and the
// board's own "cannot reach the board" banner never runs because nothing runs.
//
// The worker is exercised directly: there is no browser here, and this is
// precisely the class of defect a stub DOM reports as fine.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'sw.js'), 'utf8');
const errors = [];
const ok = (m) => console.log('ok   ' + m);
const fail = (m) => { errors.push(m); console.log('FAIL ' + m); };

// A worker global with nothing cached and no network -- the state after the
// machine serving the board has gone.
function scope(cached) {
  const handlers = {};
  const store = cached || {};
  const ctx = {
    self: {
      addEventListener: (t, fn) => { handlers[t] = fn; },
      location: { origin: 'https://board.example.ts.net' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: {
      open: () => Promise.resolve({ put() {}, add: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: (req) => {
        const url = typeof req === 'string' ? req : req.url;
        const key = new URL(url, 'https://board.example.ts.net').pathname;
        return Promise.resolve(store[key]);
      },
    },
    fetch: () => Promise.reject(new Error('offline')),
    Response, Request, URL,
    console,
  };
  ctx.self.addEventListener = (t, fn) => { handlers[t] = fn; };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { handlers, ctx };
}

function ask(handlers, url, init) {
  const req = new Request(url, init || {});
  // jsdom-free: Request.mode is not settable, so carry it alongside.
  if (init && init.navigate) Object.defineProperty(req, 'mode', { value: 'navigate' });
  let out;
  handlers.fetch({ request: req, respondWith: (p) => { out = p; } });
  return out;
}

(async () => {
  const base = 'https://board.example.ts.net';

  // 1. Nothing cached, the board is gone, the app opens.
  let { handlers } = scope({});
  let res = await ask(handlers, base + '/board', { navigate: true });
  if (!res) {
    fail('the worker resolved with nothing at all — that is the blank screen');
  } else {
    res.status === 503
      ? ok('an unreachable board answers a page request')
      : fail('unexpected status ' + res.status);
    const body = await res.text();
    body.length > 0
      ? ok('and the page has something on it')
      : fail('the page is empty, which is the blank screen by another route');
    /not answering|cannot reach|unreachable/i.test(body)
      ? ok('and it says the board is not answering')
      : fail('the page does not say what is wrong');
    /location\.reload|Try again/i.test(body)
      ? ok('and offers a way to retry, which a standalone app has no chrome for')
      : fail('there is no way to retry from inside the app');
    /<style/i.test(body) && !/src=|href=/i.test(body)
      ? ok('and is self-contained, since nothing can be fetched by definition')
      : fail('the offline page depends on something it cannot load');
  }

  // 2. The shell IS cached: hand it over, because the board's own banner is
  //    better than a generic page -- it keeps the lesson readable behind it.
  ({ handlers } = scope({ '/board': new Response('<html>the board</html>', {
    headers: { 'Content-Type': 'text/html' } }) }));
  res = await ask(handlers, base + '/board', { navigate: true });
  const cachedBody = res ? await res.text() : '';
  /the board/.test(cachedBody)
    ? ok('a cached shell is preferred, so the board can say so itself')
    : fail('the cached shell was not used');

  // 3. A home-screen icon can carry a query string.
  ({ handlers } = scope({ '/board': new Response('<html>the board</html>') }));
  res = await ask(handlers, base + '/board?from=homescreen', { navigate: true });
  const q = res ? await res.text() : '';
  /the board/.test(q)
    ? ok('and a query string does not miss the very page that was cached')
    : fail('a query string defeats the cache lookup');

  // 4. An asset with no cache must still be a response, not undefined.
  ({ handlers } = scope({}));
  res = await ask(handlers, base + '/static/board.js');
  if (!res) fail('a missing asset resolves with undefined, which is a network error');
  else res.status >= 500
    ? ok('a missing asset fails as a failure rather than as a blank document')
    : fail('unexpected status for a missing asset: ' + res.status);

  // 5. Live data is never intercepted at all, cached or not.
  ({ handlers } = scope({}));
  res = ask(handlers, base + '/board.json');
  res === undefined
    ? ok('live data is left to the network, as it must be')
    : fail('the worker intercepted a live request');

  console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                            : '\nan unreachable board still paints something');
  process.exit(errors.length ? 1 : 0);
})();
