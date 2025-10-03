const API_BASE = 'http://localhost:3000/api';
const APP_BASE = 'http://localhost:4200';

interface SeedResult {
  user: { id: string; username: string; password: string };
  group: { id: string; name: string };
  channel: { id: string; name: string };
}

function installMediaAndRtcStubs(win: any) {
  const createTrack = (kind: 'audio' | 'video') => {
    return {
      kind,
      enabled: true,
      id: `${kind}-${Math.random().toString(36).slice(2)}`,
      stop: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      onended: null as (() => void) | null
    };
  };

  const createStream = (options: { audio?: boolean; video?: boolean } = {}) => {
    const MediaStreamCtor = win.MediaStream || function thisMediaStream() {};
    if (!win.MediaStream) {
      win.MediaStream = MediaStreamCtor as any;
    }
    const stream = new MediaStreamCtor();
    const tracks: any[] = [];
    if (options.audio) {
      tracks.push(createTrack('audio'));
    }
    if (options.video) {
      tracks.push(createTrack('video'));
    }

    Object.assign(stream, {
      getTracks: () => tracks.slice(),
      getAudioTracks: () => tracks.filter(track => track.kind === 'audio'),
      getVideoTracks: () => tracks.filter(track => track.kind === 'video'),
      getTrackById: (id: string) => tracks.find(track => track.id === id) || null,
      addTrack: (track: any) => {
        tracks.push(track);
      },
      removeTrack: (track: any) => {
        const index = tracks.indexOf(track);
        if (index >= 0) {
          tracks.splice(index, 1);
        }
      }
    });

    return stream;
  };

  if (!win.navigator.mediaDevices) {
    Object.defineProperty(win.navigator, 'mediaDevices', {
      value: {},
      configurable: true,
      enumerable: true,
      writable: true
    });
  }
  const mediaDevices = Object.assign({}, win.navigator.mediaDevices);
  mediaDevices.getUserMedia = () => Promise.resolve(createStream({ audio: true, video: true }));
  mediaDevices.getDisplayMedia = () => Promise.resolve(createStream({ video: true }));
  Object.defineProperty(win.navigator, 'mediaDevices', {
    value: mediaDevices,
    configurable: true,
    enumerable: true,
    writable: true
  });

  class FakeSender {
    track: any;
    constructor(track: any) {
      this.track = track;
    }
    replaceTrack(newTrack: any) {
      this.track = newTrack;
      return Promise.resolve();
    }
  }

  class FakePeerConnection {
    senders: FakeSender[] = [];
    localDescription: any;
    remoteDescription: any;
    connectionState = 'connected';
    onicecandidate: ((event: any) => void) | null = null;
    ontrack: ((event: any) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;

    addTrack(track: any, _stream: any) {
      const sender = new FakeSender(track);
      this.senders.push(sender);
      return sender;
    }

    getSenders() {
      return this.senders.slice();
    }

    createOffer() {
      return Promise.resolve({ type: 'offer', sdp: 'fake-offer' });
    }

    setLocalDescription(desc: any) {
      this.localDescription = desc;
      return Promise.resolve();
    }

    createAnswer() {
      return Promise.resolve({ type: 'answer', sdp: 'fake-answer' });
    }

    setRemoteDescription(desc: any) {
      this.remoteDescription = desc;
      return Promise.resolve();
    }

    addIceCandidate(_candidate: any) {
      return Promise.resolve();
    }

    close() {
      return undefined;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  win.RTCPeerConnection = FakePeerConnection as any;
  win.RTCSessionDescription = function (desc: any) {
    return desc;
  } as any;
  win.RTCIceCandidate = function (candidate: any) {
    return candidate;
  } as any;

  class FakeAudioContext {
    destination = {};
    createMediaStreamSource() {
      return { connect() { return undefined; }, disconnect() { return undefined; } };
    }
    createAnalyser() {
      return {
        fftSize: 512,
        getByteTimeDomainData() { return undefined; },
        connect() { return undefined; },
        disconnect() { return undefined; }
      };
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  win.AudioContext = FakeAudioContext as any;
}

function seedCallWorkspace(): Cypress.Chainable<SeedResult> {
  const credentials = {
    username: 'callhost',
    email: 'callhost@example.com',
    password: 'CallHost123!'
  };

  return cy
    .request({
      method: 'POST',
      url: `${API_BASE}/users`,
      headers: { 'x-user-id': 'u_super' },
      body: {
        username: credentials.username,
        email: credentials.email,
        password: credentials.password,
        roles: ['user']
      }
    })
    .then(({ body: userBody }) => {
      const user = userBody.user as { id: string; username: string };

      return cy
        .request({
          method: 'POST',
          url: `${API_BASE}/groups`,
          headers: { 'x-user-id': 'u_super' },
          body: { name: 'Realtime' }
        })
        .then(({ body: groupBody }) => {
          const group = groupBody.group as { id: string; name: string };

          return cy
            .request({
              method: 'POST',
              url: `${API_BASE}/groups/${group.id}/members`,
              headers: { 'x-user-id': 'u_super' },
              body: { userId: user.id }
            })
            .then(() =>
              cy
                .request({
                  method: 'POST',
                  url: `${API_BASE}/channels`,
                  headers: { 'x-user-id': 'u_super' },
                  body: { name: 'voice', groupId: group.id }
                })
                .then(({ body: channel }) => {
                  return cy.wrap({
                    user: { id: user.id, username: user.username, password: credentials.password },
                    group,
                    channel: channel as { id: string; name: string }
                  });
                })
            );
        });
    });
}

describe('Call Experiences', () => {
  beforeEach(() => {
    cy.task('resetDb');
  });

  it('lets a host start a call, mute audio, and share the screen', () => {
    seedCallWorkspace().then(({ user, group, channel }) => {
      cy.visit(`${APP_BASE}/login`, {
        onBeforeLoad: installMediaAndRtcStubs
      });

      cy.intercept('POST', '**/api/auth/login').as('loginRequest');

      cy.get('input[formcontrolname="username"]').type(user.username);
      cy.get('input[formcontrolname="password"]').type(user.password, { log: false });
      cy.get('form.auth-form button.primary-action').click();

      cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
      cy.url({ timeout: 10000 }).should('include', '/dashboard');
      cy.contains('.group-card', group.name).click();
      cy.contains('.channel-tile h4', channel.name).click();
      cy.url({ timeout: 10000 }).should('include', `/chat/${group.id}/${channel.id}`);

      cy.get('.btn-call.start').click();
      cy.url({ timeout: 10000 }).should('include', `/call/${group.id}/${channel.id}`);

      cy.get('.control-group.live', { timeout: 10000 }).should('be.visible');
      cy.contains('.control-round', 'Mute').click();
      cy.contains('.control-round', 'Unmute').should('be.visible');
      cy.get('.video-tile.local .mute-indicator').should('be.visible');

      cy.contains('.control-round', 'Share Screen').click();
      cy.contains('.control-round', 'Stop Share').should('be.visible');
      cy.get('.video-tile.share').should('be.visible');

      cy.contains('.control-round', 'Stop Share').click();
      cy.contains('.control-round', 'Share Screen').should('be.visible');
      cy.get('.video-tile.share').should('not.exist');
    });
  });
});
