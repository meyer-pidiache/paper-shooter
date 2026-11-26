import * as views from '../presentation/screen-views.js';
import type { ScreenEvents } from '../presentation/screen-bindings.js';
import { LobbyBrowser } from './lobby-browser.js';
import type { ScreenPorts } from './screen-contracts.js';
import type { MapKey } from '../domain/maps.js';

/** Owns screen navigation/read models and user intent; templates and browser events have separate ports. */
export class ScreenController {
  private readonly browser: LobbyBrowser;
  private readonly events: ScreenEvents;
  constructor(private readonly ports: ScreenPorts) {
    const { transport, profile, actions, view } = ports;
    this.browser = new LobbyBrowser({
      active: () => transport.active,
      name: () => profile.myName,
      fetch: (name) => transport.listLobbies({ name }),
      changed: () => view.rows(this.lobbyListHTML()),
    });
    this.events = {
      begin: () => actions.begin(),
      checkpoint: (wave) => actions.beginAtWave(wave),
      mainMenu: () => actions.toMainMenu(),
      selectMap: (map) => {
        ports.selectMap(map);
        this.showStart();
      },
      online: () => {
        ports.navigation.screen = 'online';
        this.showStart();
      },
      quickPlay: () => actions.quickPlay(),
      createLobby: (isPublic) => actions.createLobby(isPublic),
      joinLobby: (code) => actions.joinLobby(code),
      missingCode: () => actions.setStatus('type the code your friend gave you'),
      rejoin: () => this.rejoin(),
      back: () => this.back(),
      refresh: () => {
        void this.refreshLobbies();
      },
      pickLobbyMap: (map) => this.pickLobbyMap(map),
      pickMode: (mode) => {
        const { transport, game, lobby, actions } = ports;
        if (!transport.isHost || game.state !== 'lobby') return;
        lobby.mode = mode;
        for (const player of lobby.players?.values() ?? []) delete player.team;
        actions.broadcastLobby();
      },
      pickDuration: (seconds) => {
        const { transport, game, lobby, actions } = ports;
        if (!transport.isHost || game.state !== 'lobby') return;
        lobby.duration = seconds;
        actions.broadcastLobby();
      },
      startMatch: () => this.requestStart(),
      leave: () => {
        ports.lobby.rejoinCode = null;
        actions.leaveOnline('');
      },
    };
  }
  dispose() {
    this.browser.dispose();
  }
  refreshLobbies() {
    return this.browser.refresh();
  }
  showConnectionStatus(message: string) {
    this.ports.view.status(message);
  }
  unlockButtons() {
    this.ports.view.unlockButtons();
  }
  renderLobby() {
    if (this.ports.game.state === 'lobby') this.showStart();
  }
  private rejoin() {
    const code = this.ports.lobby.rejoinCode;
    this.ports.lobby.rejoinCode = null;
    if (code) this.ports.actions.joinLobby(code);
  }
  private back() {
    const { actions, lobby, navigation } = this.ports;
    actions.cancelPending();
    lobby.status = '';
    lobby.rejoinCode = null;
    navigation.screen = 'main';
    this.showStart();
  }
  private pickLobbyMap(map: MapKey) {
    const { transport, lobby, actions } = this.ports;
    if (!transport.isHost || this.ports.game.state !== 'lobby' || lobby.mapLocked) return;
    lobby.map = map;
    actions.broadcastLobby();
  }
  private requestStart() {
    const { transport, actions } = this.ports;
    if (transport.isHost) actions.hostStart();
    else {
      transport.send('startreq', {});
      actions.setStatus('asking the host to start…');
    }
  }
  private lobbyListHTML() {
    const { error, view } = this.browser;
    return error === null
      ? views.lobbyListHTML(view)
      : views.lobbyErrorHTML(this.ports.actions.friendlyError(error));
  }
  private mainHTML() {
    const { profile, records, view } = this.ports;
    return views.mainHTML(
      { mapKey: profile.mapKey, best: records.best, checkpoint: records.checkpoint },
      view.settingsHTML(),
    );
  }
  private onlineHTML() {
    const { profile, lobby } = this.ports;
    return views.onlineHTML(
      {
        myName: profile.myName,
        isPublic: lobby.isPublic,
        status: lobby.status,
        rejoinCode: lobby.rejoinCode,
      },
      this.lobbyListHTML(),
    );
  }
  private lobbyHTML() {
    const { transport, lobby, profile, actions } = this.ports;
    return views.lobbyHTML({
      rows: actions.lobbyRows(),
      mode: lobby.mode,
      host: transport.isHost,
      localId: transport.id,
      hostId: lobby.hostId,
      code: transport.isHost
        ? transport.aliasCode || transport.code
        : lobby.shown || transport.code || '',
      mapKey: lobby.map || profile.mapKey,
      mapLocked: lobby.mapLocked,
      duration: lobby.duration,
      maxPlayers: transport.maxPlayers,
      isPublic: lobby.isPublic,
      status: lobby.status,
    });
  }
  private bindOnline(mode: 'online' | 'onlinePause' = 'online') {
    const { view } = this.ports;
    view.bind(mode, this.events);
  }
  showStart() {
    const { view, game, navigation } = this.ports;
    view.gameplay(false);
    if (game.state === 'lobby') navigation.screen = 'lobby';
    const html =
      navigation.screen === 'lobby'
        ? this.lobbyHTML()
        : navigation.screen === 'online'
          ? this.onlineHTML()
          : this.mainHTML();
    view.show(html);
    if (navigation.screen === 'main') view.bind('main', this.events);
    else this.bindOnline();
  }
  showPause() {
    const { online, transport, actions, game, view } = this.ports;
    if (online()) {
      view.show(
        views.pauseOnlineHTML(
          {
            code: String(transport.aliasCode || transport.code || ''),
            mode: this.ports.lobby.mode,
            localId: transport.id,
            scores: actions.sortedScores(),
          },
          view.settingsHTML(),
          view.confirm(),
        ),
      );
      this.bindOnline('onlinePause');
      return;
    }
    view.show(views.pauseSoloHTML(game, view.settingsHTML(), view.confirm()));
    view.bind('pause', this.events);
  }
  showClickToPlay() {
    this.ports.view.show(views.clickToPlayHTML(this.ports.view.confirm(), this.ports.lobby.mode));
  }
  showDead() {
    const { view, game, records } = this.ports;
    view.gameplay(false);
    const improved = records.recordBest(game.score);
    view.show(
      views.deathHTML(
        {
          score: game.score,
          wave: game.wave,
          kills: game.kills,
          best: records.best,
          checkpoint: records.checkpoint,
        },
        improved,
        view.confirm(),
      ),
    );
    view.bind('dead', this.events);
  }
}
