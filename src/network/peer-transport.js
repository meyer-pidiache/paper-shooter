import { Peer } from 'peerjs';
import { networkConfig } from './config.js';
import { createIceClient } from './ice-client.js';
import { isWireMessage, lobbyCode } from './protocol.js';
import { MAX_PLAYERS } from '../domain/match.js';
import { isGamePayload } from './game-messages.js';
import { LobbyDiscovery, PUBLIC_SLOT_COUNT } from './lobby-discovery.js';
import { LobbyQuery } from './lobby-query.js';
import { browserRejoinCredentials, newRejoinSecret } from './rejoin-credentials.js';

// Peer-to-peer networking over WebRTC, using the public PeerJS signalling service.
// The host player's browser is authoritative. A small same-origin endpoint obtains temporary
// Cloudflare TURN credentials so WebRTC can relay traffic when a direct connection is blocked.
//
// Lobby codes are just peer ids. A private lobby takes a random 5 letter code; a public lobby
// claims one of a handful of well-known ids (PUB0..PUB15) so quick play can find it by knocking on
// every slot at once - a directory with no directory server. A connection only counts once the
// host has answered with a welcome, so a full or closed lobby can be skipped for the next one.

const MAX_PUBLIC_SLOT_NETWORK_RETRIES = 5;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = () =>
  Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const JOIN_TIMEOUT = 14000,
  SIGNAL_TIMEOUT = 12000;
const STATS_PING_TYPE = 'paper:nerd-stats';
const defaults = networkConfig(
  import.meta.env,
  typeof location === 'undefined' ? 'localhost' : location.hostname,
);
const ice = createIceClient(defaults);

function closeConnection(conn) {
  try {
    conn.close();
  } catch {
    /* The channel may already be closed. */
  }
}

function closeAfterNotice(conn) {
  setTimeout(() => closeConnection(conn), 500);
}

export class Net {
  constructor({
    PeerClass = Peer,
    options = () => ice.peerOptions(),
    namespace = defaults.namespace,
    validatePayload = isGamePayload,
    rejoinCredentials = browserRejoinCredentials(),
  } = {}) {
    this.PeerClass = PeerClass;
    this.validatePayload = validatePayload;
    this.generation = 0;
    this.options = options;
    this.prefix = namespace;
    this.rejoinCredentials = rejoinCredentials;
    this.rejoinKey = null;
    this.peer = null;
    this.conns = new Map();
    this.isHost = false;
    this.id = null;
    this.code = null;
    this.hostId = null;
    this.authorityId = null;
    this.handlers = new Map();
    this.connected = false;
    this.onPeerJoin = null;
    this.onPeerResume = null;
    this.onPeerLeave = null;
    this.onDisconnect = null;
    this.onAlias = null;
    this.maxPlayers = MAX_PLAYERS;
    this.accepting = true;
    this.inMatch = false;
    this.hostName = '';
    this.stats = { sent: 0, recv: 0 };
    this.nerdStatsEnabled = false;
    this.pingSequence = 0;
    this.pendingPings = new Map();
    this.pingSamples = new Map();
    this.pingTimer = null;
    this.isPublic = false;
    this.sessionAbort = new AbortController();
    this.discovery = new LobbyDiscovery(() => this._newPeer(null), this.prefix);
  }
  get active() {
    return !!this.peer && this.connected;
  }
  get peerIds() {
    return [...this.conns.keys()];
  }
  on(type, fn) {
    this.handlers.set(type, fn);
  }
  onHost(type, fn) {
    this.on(type, (data, from) => {
      if (!this.isHost && from === this.authorityId) fn(data, from);
    });
  }
  _emit(type, data, from) {
    const h = this.handlers.get(type);
    if (h) h(data, from);
  }

  async _newPeer(id) {
    const generation = this.generation;
    const opts = await this.options();
    if (generation !== this.generation) throw new Error('lobby operation cancelled');
    return new Promise((resolve, reject) => {
      const peer = new this.PeerClass(id, opts);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          peer.destroy();
          reject(new Error('signalling server timed out'));
        }
      }, SIGNAL_TIMEOUT);
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (generation !== this.generation) {
          peer.destroy();
          reject(new Error('lobby operation cancelled'));
          return;
        }
        resolve(peer);
      });
      peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      });
    });
  }
  _wire(conn) {
    const generation = this.generation;
    conn.on('data', (msg) => {
      if (generation !== this.generation || this.conns.get(conn.peer) !== conn) return;
      this.stats.recv++;
      if (msg && msg.t === STATS_PING_TYPE) {
        this._handleStatsPing(conn, msg);
        return;
      }
      if (!isWireMessage(msg)) return;
      this._route(msg, conn.peer);
    });
    conn.on('close', () => this._drop(conn.peer, conn));
    conn.on('error', () => this._drop(conn.peer, conn));
  }
  _detach(pid) {
    this.conns.delete(pid);
    this.pingSamples.delete(pid);
    for (const [key, pending] of this.pendingPings)
      if (pending.peerId === pid) this.pendingPings.delete(key);
  }
  _drop(pid, connection, reason) {
    if (this.leaving || this.conns.get(pid) !== connection) return;
    this._detach(pid);
    if (this.isHost) {
      this.send('leave', { id: pid });
      if (reason) this.onPeerLeave?.(pid, reason);
      else this.onPeerLeave?.(pid);
      if (!this.conns.size) this._stopPingPolling();
    } else if (pid === this.hostId) {
      this.connected = false;
      this._stopPingPolling();
      if (this.onDisconnect) this.onDisconnect();
    }
  }
  dropPeer(id, reason) {
    const connection = this.conns.get(id);
    if (!connection) return false;
    this._drop(id, connection, reason);
    closeConnection(connection);
    return true;
  }
  _now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }
  _handleStatsPing(conn, message) {
    if (message.kind === 'ping' && Number.isSafeInteger(message.id)) {
      if (conn.open) conn.send({ t: STATS_PING_TYPE, kind: 'pong', id: message.id });
      return;
    }
    if (message.kind !== 'pong' || !Number.isSafeInteger(message.id)) return;
    const key = `${conn.peer}:${message.id}`;
    const pending = this.pendingPings.get(key);
    if (!pending) return;
    this.pendingPings.delete(key);
    this.pingSamples.set(conn.peer, {
      value: Math.max(0, this._now() - pending.started),
      at: this._now(),
    });
  }
  _startPingPolling() {
    if (!this.nerdStatsEnabled || this.pingTimer != null || !this.active || !this.conns.size)
      return;
    this.pingTimer = setInterval(() => {
      if (!this.active) return;
      const now = this._now();
      for (const [key, pending] of this.pendingPings)
        if (now - pending.started > 5000) this.pendingPings.delete(key);
      for (const [peerId, connection] of this.conns) {
        if (!connection.open) continue;
        if ([...this.pendingPings.values()].some((pending) => pending.peerId === peerId)) continue;
        const id = ++this.pingSequence;
        const key = `${peerId}:${id}`;
        this.pendingPings.set(key, { peerId, started: now });
        connection.send({ t: STATS_PING_TYPE, kind: 'ping', id });
      }
    }, 1500);
  }
  _stopPingPolling() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pendingPings.clear();
    this.pingSamples.clear();
  }
  setNerdStatsEnabled(enabled) {
    this.nerdStatsEnabled = !!enabled;
    if (this.nerdStatsEnabled) {
      this._startPingPolling();
      return;
    }
    this._stopPingPolling();
  }
  getNerdPing() {
    if (!this.active) return { value: null, label: this.isHost ? 'PEERS MEDIAN' : 'HOST' };
    const now = this._now();
    if (!this.isHost) {
      const sample = this.pingSamples.get(this.hostId);
      return {
        value: sample && now - sample.at <= 5000 ? sample.value : null,
        label: 'HOST',
      };
    }
    const values = [...this.pingSamples.values()]
      .filter((sample) => now - sample.at <= 5000)
      .map((sample) => sample.value)
      .sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length
      ? values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2
      : null;
    return { value: median, label: `PEERS MEDIAN · ${values.length}` };
  }
  _validMessage(msg) {
    return isWireMessage(msg) && this.validatePayload(msg.t, msg.d);
  }
  _route(msg, from) {
    if (!this._validMessage(msg)) return;
    if (msg.t === 'rejoin-token') {
      if (!this.isHost && from === this.hostId && msg.from === this.authorityId)
        this.rejoinCredentials.save(this.code, { hostId: this.authorityId, ...msg.d });
      return;
    }
    if (msg.t === 'stay') return;
    const sender = this.isHost ? from : msg.from || from;
    // clients can address each other; the host forwards those
    if (this.isHost && msg.to && msg.to !== this.id) {
      const c = this.conns.get(msg.to);
      if (c && c.open) c.send({ ...msg, from: sender });
      return;
    }
    if (this.isHost && msg.relay) {
      for (const [pid, c] of this.conns)
        if (pid !== from && c.open) c.send({ t: msg.t, d: msg.d, from });
    }
    this._emit(msg.t, msg.d, sender);
  }
  _keepAlive(peer) {
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) {
        try {
          peer.reconnect();
        } catch (e) {
          /* ignore */
        }
      }
    });
  }

  // ---- lobby creation / joining ----
  /** @param {{ isPublic?: boolean, code?: string | null }} [options] */
  async host({ isPublic = false, code = null } = {}) {
    this.leave();
    this.isHost = true;
    this.isPublic = isPublic;
    if (code) {
      this.code = String(code).toUpperCase();
      this.peer = await this._newPeer(this.prefix + this.code);
    } else if (isPublic) {
      let networkRetries = 0;
      for (let slot = 0; slot < PUBLIC_SLOT_COUNT;) {
        const slotCode = 'PUB' + slot;
        try {
          this.peer = await this._newPeer(this.prefix + slotCode);
          this.code = slotCode;
          break;
        } catch (e) {
          const occupied = !!(e && e.type === 'unavailable-id');
          const retryNetwork = !!(
            e &&
            e.type === 'network' &&
            networkRetries < MAX_PUBLIC_SLOT_NETWORK_RETRIES
          );
          if (occupied) {
            slot++;
            continue;
          }
          if (retryNetwork) {
            networkRetries++;
            continue;
          }
          throw e;
        }
      }
      if (!this.peer) throw new Error('all public lobbies are busy - host a private one');
    } else {
      for (let tries = 0; tries < 3 && !this.peer; tries++) {
        this.code = makeCode();
        try {
          this.peer = await this._newPeer(this.prefix + this.code);
        } catch (e) {
          if (!(e && e.type === 'unavailable-id') || tries === 2) throw e;
        }
      }
    }
    this.id = this.peer.id;
    this.hostId = this.id;
    this.authorityId = this.id;
    this.rejoinKey = newRejoinSecret();
    this.connected = true;
    this.accepting = true;
    this.peer.on('connection', (conn) => this._incoming(conn));
    this._keepAlive(this.peer);
    this._startPingPolling();
    return this.code;
  }
  _lobbyOffer() {
    return {
      hostId: this.id,
      code: this.aliasCode || this.code,
      isPublic: this.isPublic,
      players: this.conns.size + 1,
      max: this.maxPlayers,
      inMatch: !!this.inMatch,
      hostName: this.hostName,
    };
  }
  _refuse(conn, reason = this.accepting ? 'that lobby is full' : 'that lobby is closed') {
    conn.send({ t: 'refused', d: { ...this._lobbyOffer(), reason } });
    closeAfterNotice(conn);
  }
  _sendWelcome(conn, details = this._lobbyOffer()) {
    conn.send({ t: 'welcome', d: details, from: this.id });
  }
  _seat(conn, { reply, resume = false, token }) {
    if (!conn.open || this.conns.has(conn.peer)) return;
    const previous = token && this.onPeerResume?.(token);
    const old = previous && this.conns.get(previous);
    if (!this.accepting || (this._full() && !old)) {
      this._refuse(conn);
      return;
    }
    if (resume && !previous) {
      this._refuse(conn, 'score recovery is unavailable');
      return;
    }
    if (old) {
      // Notify the old client before closing so it does not elect itself as a new host.
      this.sendTo(previous, 'kick', { reason: 'you rejoined from another connection' });
      this._detach(previous);
      closeAfterNotice(old);
    }
    if (reply) this._sendWelcome(conn);
    this.conns.set(conn.peer, conn);
    this._wire(conn);
    this._startPingPolling();
    this.onPeerJoin?.(conn.peer, conn.metadata || {}, previous || undefined);
  }
  _full() {
    return this.conns.size >= this.maxPlayers - 1;
  }
  // Discovery and score recovery claim a seat only after the guest selects this channel.
  _incoming(conn) {
    const generation = this.generation;
    conn.on('open', () => {
      if (generation !== this.generation) {
        closeConnection(conn);
        return;
      }
      const resume = conn.metadata?.resume === true;
      if (!this.accepting || (this._full() && !resume)) {
        this._refuse(conn);
      } else if (resume || conn.metadata?.probe) {
        const onData = (msg) => {
          if (!this._validMessage(msg) || msg.t !== 'stay') return;
          conn.off('data', onData);
          if (generation === this.generation)
            this._seat(conn, { reply: resume, resume, token: resume ? msg.d?.token : undefined });
        };
        conn.on('data', onData);
        const offer = this._lobbyOffer();
        if (resume) offer.rejoinKey = this.rejoinKey;
        this._sendWelcome(conn, offer);
      } else {
        this._seat(conn, { reply: true });
      }
    });
  }
  // after a host transfer the lobby lives on a generation code; keep trying to open the original code
  // as a second front door so it stays the code people know
  claimAlias(code, tries = 20) {
    if (!this.isHost || this.alias || this._aliasTimer) return;
    const attempt = async () => {
      this._aliasTimer = null;
      if (!this.isHost || this.alias) return;
      try {
        const peer = await this._newPeer(this.prefix + code);
        if (!this.isHost) {
          peer.destroy();
          return;
        }
        this.alias = peer;
        this.aliasCode = code;
        peer.on('connection', (conn) => this._incoming(conn));
        if (this.onAlias) this.onAlias(code);
      } catch (e) {
        if (--tries > 0) this._aliasTimer = setTimeout(attempt, 6000);
      }
    };
    this._aliasTimer = setTimeout(attempt, 1500);
  }
  _adoptOffer(peer, offer) {
    this.peer = peer;
    this.id = peer.id;
    this.code = lobbyCode(offer.details.code, offer.hostId.slice(this.prefix.length));
    this._keepAlive(peer);
    this._adopt(offer.hostId, offer.connection, offer.details);
  }
  _queryLobby(peer, ids, metadata, rejoinToken) {
    return new LobbyQuery(peer, ids, metadata, {
      mode: 'first',
      timeout: JOIN_TIMEOUT,
      gather: 0,
      signal: this.sessionAbort.signal,
      rejoinToken,
      adopt: (offer) => this._adoptOffer(peer, offer),
    }).run();
  }
  async _resume(peer, credential, meta) {
    const generation = this.generation;
    try {
      // Older hosts see an ordinary probe and wait for stay before they allocate a seat.
      await this._queryLobby(
        peer,
        [credential.hostId],
        { ...meta, resume: true, probe: true },
        (key) => (key === credential.key ? credential.token : undefined),
      );
      return true;
    } catch (error) {
      if (generation !== this.generation) throw error;
      return false;
    }
  }
  async join(code, meta = {}, wantId = null) {
    this.leave();
    this.isHost = false;
    code = String(code || '')
      .trim()
      .toUpperCase();
    if (!code) throw new Error('enter a lobby code');
    this.peer = await this._newPeer(null);
    const generation = this.generation;
    // a lobby that changed hosts lives on a generation code; the plain code still finds it
    const base = code.replace(/-\d+$/, '');
    const ids = [
      code,
      ...['-1', '-2', '-3'].map((suf) => base + suf).filter((c) => c !== code),
    ].map((c) => this.prefix + c);
    try {
      const credential = !meta.prev && this.rejoinCredentials.get(code);
      if (
        credential &&
        ids.includes(credential.hostId) &&
        (await this._resume(this.peer, credential, meta))
      )
        return this.code;
      await this._queryLobby(this.peer, ids, meta);
    } catch (error) {
      if (generation === this.generation) this.leave();
      throw error;
    }
    return this.code;
  }

  /**
   * @param {Record<string, unknown>} [meta]
   * @param {((message: string) => void) | null} [onStatus]
   */
  async quickJoin(meta = {}, onStatus = null) {
    this.leave();
    const generation = this.generation;
    try {
      const credential = this.rejoinCredentials.latestPublic(this.prefix, PUBLIC_SLOT_COUNT);
      if (credential) {
        const peer = await this._newPeer(null);
        try {
          onStatus?.('rejoining your last match…');
          if (generation !== this.generation) throw new Error('lobby operation cancelled');
          if (await this._resume(peer, credential, meta)) return this.code;
        } finally {
          if (this.peer !== peer) peer.destroy();
        }
      }
      await this.discovery.join(meta, (peer, offer) => this._adoptOffer(peer, offer), onStatus);
    } catch (error) {
      if (generation === this.generation) this.leave();
      throw error;
    }
    return this.code;
  }

  /**
   * @param {Record<string, unknown>} [meta]
   * @param {((message: string) => void) | null} [onStatus]
   */
  async listLobbies(meta = {}, onStatus = null) {
    if (this.active) throw new Error('leave the lobby first');
    return this.discovery.browse(meta, onStatus);
  }
  _adopt(hostId, conn, welcome) {
    this.pingSamples.clear();
    this.pendingPings.clear();
    this.hostId = hostId;
    // The physical connection may target a reclaimed alias after migration. The host broadcasts
    // with its canonical generation id, which is also used by the lobby and score tables.
    this.authorityId = typeof welcome?.hostId === 'string' ? welcome.hostId : hostId;
    this.conns.set(hostId, conn);
    this.connected = true;
    this.isPublic = !!(welcome && welcome.isPublic);
    this._wire(conn);
    this._startPingPolling();
  }
  leave() {
    this.generation++;
    this.sessionAbort.abort();
    this.sessionAbort = new AbortController();
    this.discovery.cancel();
    this._stopPingPolling();
    // closing our own connections must not look like other people leaving
    this.leaving = true;
    clearTimeout(this._aliasTimer);
    this._aliasTimer = null;
    if (this.alias) {
      try {
        this.alias.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.alias = null;
    this.aliasCode = null;
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch (e) {
        /* ignore */
      }
    }
    this.conns.clear();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.peer = null;
    this.connected = false;
    this.isHost = false;
    this.inMatch = false;
    this.id = null;
    this.code = null;
    this.hostId = null;
    this.authorityId = null;
    this.rejoinKey = null;
    this.leaving = false;
  }

  // ---- messaging ----
  // host: to everyone; client: to the host (and on to everyone if relay is set)
  send(type, data, relay = false) {
    this.stats.sent++;
    if (this.isHost) {
      const m = { t: type, d: data, from: this.id };
      for (const c of this.conns.values()) if (c.open) c.send(m);
    } else {
      const c = this.conns.get(this.hostId);
      if (c && c.open) c.send({ t: type, d: data, relay });
    }
  }
  broadcast(type, data) {
    this.send(type, data, true);
  }
  sendTo(pid, type, data) {
    this.stats.sent++;
    if (this.isHost) {
      const c = this.conns.get(pid);
      if (c && c.open) c.send({ t: type, d: data, from: this.id });
    } else {
      const c = this.conns.get(this.hostId);
      if (c && c.open) c.send({ t: type, d: data, to: pid, from: this.id });
    }
  }
}
