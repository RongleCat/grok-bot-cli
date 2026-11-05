// Installed with node --import or bun --preload. Replaces fetch only when
// GROK_BOT_EXIT_FIXTURE is set. Must not write to stdout.

const mode = process.env.GROK_BOT_EXIT_FIXTURE;
if (mode) {
  const framed = (data, flag = 0) => {
    const payload = Buffer.from(JSON.stringify(data));
    const header = Buffer.alloc(5);
    header[0] = flag;
    header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]);
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  const agent = { agentId: 'bot-alpha', name: 'Alpha', title: 'A', role: 'main', viewerSessionId: 'sess-a' };

  globalThis.fetch = async (url, init) => {
    const target = String(url);
    try {
      if (target.endsWith('/ListGrokBotAgents')) return json({ agents: [agent], truncated: false });
      if (target.endsWith('/ListGrokBotTranscriptEntries')) {
        const request = JSON.parse(init.body);
        const limit = Number(request.limit) || 1;
        if (mode === 'transcript') {
          const count = Math.min(limit, 500);
          const entries = [];
          for (let index = 0; index < count; index += 1) {
            const content = `line-${index}-` + 'x'.repeat(2048);
            entries.push({
              seq: String(index + 1),
              updatedSeq: String(index + 1),
              entryId: `e-${index}`,
              entryKind: 'message',
              body: Buffer.from(JSON.stringify({ kind: 'message', role: 'assistant', content })).toString('base64'),
            });
          }
          return json({ generation: 1, entries });
        }
        return json({ generation: 1, entries: [] });
      }
      if (target.endsWith('/SendGrokBotUserMessage')) return json({ delivery: 1, dispatched: true });
      if (target.endsWith('/ListGrokBotAgentStatuses')) {
        return json({
          statuses: [{
            agentId: 'bot-alpha',
            isRunning: true,
            live: {
              agentId: 'bot-alpha',
              sessionId: '',
              isRunning: true,
              isComposingMessage: false,
              isRetrying: false,
              hasRunningSubagents: true,
            },
          }],
        });
      }
      if (target.endsWith('/WatchGrokBotTranscripts')) {
        const progress = framed({
          rows: {
            agentId: 'bot-alpha',
            sessionId: '',
            generation: 1,
            entries: [{
              seq: '5',
              updatedSeq: '5',
              entryId: 'progress-1',
              entryKind: 'message',
              body: Buffer.from(JSON.stringify({
                id: 'progress-1',
                kind: 'message',
                role: 'assistant',
                content: '正在查…',
              })).toString('base64'),
            }],
          },
        });
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(framed({ connected: { serverTimeMs: '1' } }));
            controller.enqueue(progress);
            const stop = () => {
              try { controller.error(init?.signal?.reason ?? new DOMException('aborted', 'AbortError')); } catch { /* already closed */ }
            };
            if (init?.signal?.aborted) stop();
            else init?.signal?.addEventListener('abort', stop, { once: true });
          },
        }), { headers: { 'content-type': 'application/connect+json' } });
      }
    } catch (error) {
      process.stderr.write(`fixture failed ${error instanceof Error ? error.message : error}\n`);
    }
    process.stderr.write(`unexpected fixture url ${target}\n`);
    return json({ error: 'unexpected', url: target }, 500);
  };
}
