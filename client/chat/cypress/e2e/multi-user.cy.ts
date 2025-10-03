const API_BASE = 'http://localhost:3000/api';
const APP_BASE = 'http://localhost:4200';

interface DualSeed {
  primary: { id: string; username: string; password: string };
  secondary: { id: string; username: string; password: string };
  group: { id: string; name: string };
  channel: { id: string; name: string };
}

function seedDualWorkspace(): Cypress.Chainable<DualSeed> {
  const timestamp = Date.now();
  const primaryCreds = {
    username: `primary_${timestamp}`,
    email: `primary_${timestamp}@example.com`,
    password: 'PrimaryUser!23'
  };
  const secondaryCreds = {
    username: `secondary_${timestamp}`,
    email: `secondary_${timestamp}@example.com`,
    password: 'SecondaryUser!23'
  };

  return cy
    .request({
      method: 'POST',
      url: `${API_BASE}/groups`,
      headers: { 'x-user-id': 'u_super' },
      body: { name: `Realtime ${timestamp}` }
    })
    .then(({ body: groupBody }) => {
      const group = groupBody.group as { id: string; name: string };

      return cy
        .request({
          method: 'POST',
          url: `${API_BASE}/channels`,
          headers: { 'x-user-id': 'u_super' },
          body: { name: 'general', groupId: group.id }
        })
        .then(({ body: channel }) => {
          const createUser = (cred: typeof primaryCreds) =>
            cy
              .request({
                method: 'POST',
                url: `${API_BASE}/users`,
                headers: { 'x-user-id': 'u_super' },
                body: cred
              })
              .then(({ body: userBody }) => userBody.user as { id: string; username: string });

          return createUser(primaryCreds).then(primaryUser =>
            createUser(secondaryCreds).then(secondaryUser =>
              cy
                .request({
                  method: 'POST',
                  url: `${API_BASE}/groups/${group.id}/members`,
                  headers: { 'x-user-id': 'u_super' },
                  body: { userId: primaryUser.id }
                })
                .then(() =>
                  cy
                    .request({
                      method: 'POST',
                      url: `${API_BASE}/groups/${group.id}/members`,
                      headers: { 'x-user-id': 'u_super' },
                      body: { userId: secondaryUser.id }
                    })
                    .then(() =>
                      cy.wrap({
                        primary: { id: primaryUser.id, username: primaryUser.username, password: primaryCreds.password },
                        secondary: { id: secondaryUser.id, username: secondaryUser.username, password: secondaryCreds.password },
                        group,
                        channel: channel as { id: string; name: string }
                      })
                    )
                )
            )
          );
        });
    });
}

describe('Multi-user Collaboration', () => {
  beforeEach(() => {
    cy.task('resetDb');
  });

  it('delivers live chat updates between two members', () => {
    seedDualWorkspace().then(({ primary, secondary, group, channel }) => {
      cy.visit(`${APP_BASE}/login`);
      cy.intercept('POST', '**/api/auth/login').as('loginRequest');

      cy.get('input[formcontrolname="username"]').type(primary.username);
      cy.get('input[formcontrolname="password"]').type(primary.password, { log: false });
      cy.get('form.auth-form button.primary-action').click();

      cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
      cy.url({ timeout: 10000 }).should('include', '/dashboard');

      cy.contains('.group-card', group.name).click();
      cy.contains('.channel-tile h4', channel.name).click();
      cy.url({ timeout: 10000 }).should('include', `/chat/${group.id}/${channel.id}`);

      const primaryMessage = `Primary ping ${Date.now()}`;
      cy.get('textarea.message-input').type(primaryMessage);
      cy.get('button.btn-send').click();
      cy.contains('.message.own-message .message-text', primaryMessage).should('be.visible');

      const secondaryMessage = `Secondary reply ${Date.now()}`;
      cy.request({
        method: 'POST',
        url: `${API_BASE}/messages`,
        headers: { 'x-user-id': secondary.id },
        body: {
          groupId: group.id,
          channelId: channel.id,
          content: secondaryMessage
        }
      }).then(({ body }) => {
        expect(body).to.have.property('success', true);
      });

      cy.contains('.message .message-text', secondaryMessage, { timeout: 10000 }).should('be.visible');
      cy.contains('.message .message-author', secondary.username, { timeout: 10000 }).should('be.visible');
    });
  });
});
