import { API_BASE, APP_BASE } from '../support/constants';

interface SeededUser {
  id: string;
  username: string;
  email: string;
  password: string;
}

interface SeedResult {
  user: SeededUser;
  group: { id: string; name: string };
  channel: { id: string; name: string };
}

function seedMemberWorkspace(): Cypress.Chainable<SeedResult> {
  const credentials: SeededUser = {
    id: '',
    username: 'alex',
    email: 'alex@example.com',
    password: 'Password123!'
  };

  return cy
    .request({
      method: 'POST',
      url: `${API_BASE}/groups`,
      headers: { 'x-user-id': 'u_super' },
      body: { name: 'Engineering' }
    })
    .then(({ body }) => {
      expect(body).to.have.property('success', true);
      expect(body).to.have.property('group');
      const group = body.group as { id: string; name: string };

      return cy
        .request({
          method: 'POST',
          url: `${API_BASE}/channels`,
          headers: { 'x-user-id': 'u_super' },
          body: { name: 'general', groupId: group.id }
        })
        .then(({ body: channel }) => {
          expect(channel).to.have.property('id');
          expect(channel).to.have.property('name');

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
            .then(({ body: userCreate }) => {
              expect(userCreate).to.have.property('success', true);
              const created = userCreate.user as { id: string; username: string; email: string };
              credentials.id = created.id;

              return cy
                .request({
                  method: 'POST',
                  url: `${API_BASE}/groups/${group.id}/members`,
                  headers: { 'x-user-id': 'u_super' },
                  body: { userId: created.id }
                })
                .then(() => {
                  return cy
                    .request({
                      method: 'POST',
                      url: `${API_BASE}/messages`,
                      headers: { 'x-user-id': created.id },
                      body: {
                        groupId: group.id,
                        channelId: (channel as { id: string }).id,
                        content: 'Seeded hello from automation'
                      }
                    })
                    .then(() => {
                      return cy.wrap({
                        user: credentials,
                        group,
                        channel: channel as { id: string; name: string }
                      });
                    });
                });
            });
        });
    });
}

function registerUserViaUi(username: string, email: string, password: string) {
  cy.visit(`${APP_BASE}/login`);
  cy.contains('button.toggle', 'Create Account').click();
  cy.get('form.auth-form').within(() => {
    cy.get('input[formcontrolname="username"]').type(username);
    cy.get('input[formcontrolname="email"]').type(email);
    cy.get('input[formcontrolname="password"]').type(password);
    cy.root().submit();
  });
}

describe('Member Journeys', () => {
  beforeEach(() => {
    cy.task('resetDb');
  });

  it('allows a visitor to register and receive success feedback', () => {
    registerUserViaUi('newbie', 'newbie@example.com', 'TestPassword1!');

    cy.contains('button.toggle', 'Sign In').should('have.class', 'active');
    cy.contains('.toast.success .message', 'Registration successful. Please log in.').should('exist');
  });

  it('allows a member to login, explore the dashboard, and chat in a channel', () => {
    seedMemberWorkspace().then(({ user, group, channel }) => {
      cy.visit(`${APP_BASE}/login`);

      cy.intercept('POST', '**/api/auth/login').as('loginRequest');

      cy.get('input[formcontrolname="username"]').type(user.username);
      cy.get('input[formcontrolname="password"]').type(user.password, { log: false });
      cy.get('form.auth-form button.primary-action').click();

      cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
      cy.url({ timeout: 10000 }).should('include', '/dashboard');
      cy.contains('.greeting', `Hi, ${user.username}`).should('be.visible');

      cy.contains('.group-card', group.name).as('groupCard').should('be.visible');
      cy.get('@groupCard').click();
      cy.contains('.group-hero h2', group.name).should('be.visible');

      cy.contains('.channel-tile h4', channel.name).as('channelTile').should('be.visible');
      cy.get('@channelTile').click();

      cy.url().should('include', `/chat/${group.id}/${channel.id}`);
      cy.contains('.message', 'Seeded hello from automation').should('be.visible');

      const message = `Automated ping ${Date.now()}`;
      cy.get('textarea.message-input').type(message);
      cy.get('button.btn-send').click();

      cy.contains('.message.own-message .message-text', message).should('be.visible');
    });
  });

  it('supports uploading an image attachment within chat', () => {
    seedMemberWorkspace().then(({ user, group, channel }) => {
      cy.visit(`${APP_BASE}/login`);

      cy.intercept('POST', '**/api/auth/login').as('loginRequest');

      cy.get('input[formcontrolname="username"]').type(user.username);
      cy.get('input[formcontrolname="password"]').type(user.password, { log: false });
      cy.get('form.auth-form button.primary-action').click();

      cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
      cy.url({ timeout: 10000 }).should('include', '/dashboard');
      cy.contains('.group-card', group.name).click();
      cy.contains('.channel-tile h4', channel.name).click();
      cy.url({ timeout: 10000 }).should('include', `/chat/${group.id}/${channel.id}`);

      const caption = `Image drop ${Date.now()}`;
      cy.intercept('POST', '**/api/messages/upload').as('imageUpload');

      cy.get('button.btn-attach').click();
      cy.get('input[type="file"]').selectFile('cypress/fixtures/tiny-image.png', { force: true });
      cy.get('textarea.message-input').type(caption);
      cy.get('button.btn-send').click();

      cy.wait('@imageUpload').its('response.statusCode').should('eq', 200);
      cy.contains('.message.own-message .message-text', caption).should('be.visible');
      cy.get('.message.own-message .message-image img').should('be.visible');
    });
  });
});
