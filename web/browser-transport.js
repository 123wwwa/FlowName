export function runRecovery(payload, signal, onEvent) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { payload.apiKey = ''; reject(new DOMException('Stopped', 'AbortError')); return; }
    const worker = new Worker(new URL('./browser-worker.js', import.meta.url), {type: 'module'});
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      worker.terminate(); payload.apiKey = '';
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Session time limit reached (20 minutes). Received suggestions are preserved.')), 20 * 60 * 1000);
    signal.addEventListener('abort', abort, {once: true});
    worker.onerror = () => finish(new Error('Browser worker failed. Try a smaller input or a current browser.'));
    worker.onmessageerror = () => finish(new Error('Could not read a worker response.'));
    worker.onmessage = ({data}) => {
      if (finished) return;
      try { onEvent(data); if (data.type === 'complete') finish(); }
      catch (error) { finish(error); }
    };
    try { worker.postMessage(payload); payload.apiKey = ''; }
    catch (error) { finish(error); }
  });
}
