// A turn stays busy while the bot is running or composing and the user has not
// been asked to respond. SDK agent.state and listAgentStatuses expose isRunning,
// isComposingMessage, isRetrying, and hasRunningSubagents.
// A busy-to-idle agent.state ends the wait (agent-idle). When that sample never
// arrives, or the flags stay busy after the text has gone quiet, listAgentStatuses
// confirms the bot has stopped (status-idle). Text received while it is still
// running is progress, not the final reply.

import { STATUS_PROBE_INTERVAL_MS } from './constants.mjs';

function rowActive(row) {
  return row?.isRunning === true || row?.isComposingMessage === true || row?.isRetrying === true || row?.hasRunningSubagents === true;
}

// A listAgentStatuses query for one bot. An empty list means that bot is not running.
export function agentIsRunning(statuses, botId) {
  const rows = Array.isArray(statuses) ? statuses : [];
  const row = rows.find(item => item?.agentId === botId);
  if (!row) return false;
  if (row.isRunning === true) return true;
  return rowActive(row.live);
}

export function createTurnWait({ timeoutMs, idleMs, userText, startedAt, probeIntervalMs = STATUS_PROBE_INTERVAL_MS }) {
  const texts = new Map();
  const order = [];
  const state = {
    active: false,
    sawActive: false,
    idleSince: null,
    lastTextAt: null,
    failure: null,
    statusRunning: null,
    lastProbeAt: null,
    finalProbeDone: false,
  };
  const user = String(userText ?? '').trim();

  function note(id, text, streaming, now) {
    const key = id || `text-${order.length + 1}`;
    if (!texts.has(key)) order.push(key);
    texts.set(key, { text, streaming });
    state.lastTextAt = now;
    state.statusRunning = null;
  }

  function joined() {
    return order.map(id => texts.get(id).text).join('\n\n');
  }

  function streaming() {
    for (const item of texts.values()) if (item.streaming) return true;
    return false;
  }

  function apply(event, now) {
    if (event?.type === 'turn.failed') {
      state.failure = event.data ?? {};
      return;
    }
    if (event?.type === 'agent.state') {
      const live = Array.isArray(event.data?.live) ? event.data.live : [];
      const snapshot = event.data?.snapshot === true;
      if (!live.length && !snapshot) return;
      const active = live.some(rowActive);
      state.active = active;
      if (active) {
        state.sawActive = true;
        state.idleSince = null;
        state.statusRunning = null;
      } else if (state.idleSince == null) state.idleSince = now;
      return;
    }
    if (event?.type === 'message') {
      if (event.data?.replay === true) return;
      const text = event.data?.text;
      if (typeof text !== 'string' || !text.trim() || text.trim() === user) return;
      note(event.data.entryId || event.id, text, false, now);
      return;
    }
    if (event?.type === 'entry') {
      if (event.data?.replay === true) return;
      const entry = event.data?.entry;
      if (!entry || typeof entry !== 'object') return;
      const kind = String(entry.kind || event.data?.entryKind || '').toLowerCase();
      if (kind !== 'message' && !kind.includes('send-message')) return;
      // A user turn is only role=user. send-message is a bot reply.
      if (entry.role === 'user' || entry.message?.role === 'user') return;
      const text = typeof entry.content === 'string'
        ? entry.content
        : typeof entry.text === 'string'
          ? entry.text
          : typeof entry.message?.content === 'string'
            ? entry.message.content
            : '';
      if (!text.trim() || text.trim() === user) return;
      const streaming = entry.streaming === true || entry.isStreaming === true || entry.message?.streaming === true || entry.message?.isStreaming === true;
      note(event.data.entryId || entry.id, text, streaming, now);
    }
  }

  function decide(now) {
    if (state.failure) {
      return { done: true, ok: false, reason: 'turn-failed', text: joined(), summary: String(state.failure.summary ?? ''), failureCode: state.failure.code ?? '' };
    }
    const text = joined();
    const quietFor = state.lastTextAt == null ? null : now - state.lastTextAt;
    const idleFor = state.idleSince == null ? null : now - state.idleSince;
    const quietEnough = Boolean(text) && quietFor != null && quietFor >= idleMs;
    const timedOut = now >= startedAt + timeoutMs;
    if (state.sawActive && !state.active && text && !streaming() && quietEnough && idleFor != null && idleFor >= idleMs) {
      return { done: true, ok: true, reason: 'agent-idle', text };
    }
    if (state.statusRunning === false && text && (state.finalProbeDone || quietEnough)) {
      return { done: true, ok: true, reason: 'status-idle', text };
    }
    if (timedOut && (!text || state.finalProbeDone)) {
      return { done: true, ok: false, reason: 'timeout', text };
    }
    const eventSettling = state.sawActive && !state.active && text && !streaming() && state.idleSince != null;
    const probeDue = quietEnough && !eventSettling && (state.lastProbeAt == null || now - state.lastProbeAt >= probeIntervalMs);
    if (probeDue && !state.finalProbeDone) return { probe: true, final: false };
    if (timedOut && text && !state.finalProbeDone) return { probe: true, final: true };
    return null;
  }

  return {
    push(event, now) {
      apply(event, now);
      return decide(now);
    },
    poll(now) {
      return decide(now);
    },
    noteStatus(running, now, options = {}) {
      state.lastProbeAt = now;
      if (options.final === true) state.finalProbeDone = true;
      if (options.failed === true) state.statusRunning = null;
      else state.statusRunning = running === true;
      return decide(now);
    },
    nextWait(now) {
      const untilTimeout = startedAt + timeoutMs - now;
      if (untilTimeout <= 0) return 0;
      const text = joined();
      if (!text || state.lastTextAt == null) return untilTimeout;
      const quietFor = now - state.lastTextAt;
      const quietLeft = idleMs - quietFor;
      if (state.sawActive && !state.active && !streaming() && state.idleSince != null) {
        const idleLeft = idleMs - (now - state.idleSince);
        const wait = Math.max(quietLeft, idleLeft);
        if (wait > 0) return Math.min(untilTimeout, wait);
      }
      if (quietLeft > 0) return Math.min(untilTimeout, quietLeft);
      if (state.statusRunning === false) return untilTimeout;
      const probeLeft = state.lastProbeAt == null ? 0 : probeIntervalMs - (now - state.lastProbeAt);
      return Math.max(0, Math.min(untilTimeout, probeLeft));
    },
    finish(reason, now) {
      const decision = decide(now);
      if (decision) return decision;
      const text = joined();
      if (reason === 'timeout') {
        if (text && !state.finalProbeDone) return { probe: true, final: true };
        return { done: true, ok: false, reason: 'timeout', text };
      }
      if (state.statusRunning === false && text) return { done: true, ok: true, reason: 'status-idle', text };
      if (text && !state.finalProbeDone) return { probe: true, final: true };
      return { done: true, ok: false, reason: 'stream-closed', text };
    },
    forceClosed() {
      const text = joined();
      if (state.statusRunning === false && text) return { done: true, ok: true, reason: 'status-idle', text };
      return { done: true, ok: false, reason: 'stream-closed', text };
    },
    forceTimeout() {
      return { done: true, ok: false, reason: 'timeout', text: joined() };
    },
  };
}
