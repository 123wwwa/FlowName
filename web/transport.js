// Local Node-hosted transport. The Pages build substitutes the browser transport.
export async function runRecovery(payload, signal, onEvent) {
  const response = await fetch('./api/recover', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload), signal,
  });
  payload.apiKey = '';
  if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', completed = false;
  while (true) {
    const {value, done} = await reader.read();
    buffer += decoder.decode(value, {stream: !done});
    let split;
    while ((split = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, split); buffer = buffer.slice(split + 1);
      if (line) { const event = JSON.parse(line); onEvent(event); if (event.type === 'complete') completed = true; }
    }
    if (done) break;
  }
  if (!completed) throw new Error('The connection closed. Received suggestions are preserved.');
}
