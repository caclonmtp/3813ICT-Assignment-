import { API_BASE, APP_BASE } from '../support/constants';

interface SuperGroupSeed {
  group: { id: string; name: string };
}

interface GroupAdminSeed {
  admin: { id: string; username: string; password: string };
  group: { id: string; name: string };
  invitee: { id: string; username: string; email: string };
}

function seedSuperAdminWorkspace(): Cypress.Chainable<SuperGroupSeed> {
  return cy
    .request({
      method: 'POST',
      url: `${API_BASE}/groups`,
      headers: { 'x-user-id': 'u_super' },
      body: { name: 'Operations' }
    })
    .then(({ body }) => {
      expect(body).to.have.property('success', true);
      const group = body.group as { id: string; name: string };

      return cy
        .request({
          method: 'POST',
          url: `${API_BASE}/channels`,
          headers: { 'x-user-id': 'u_super' },
          body: { name: 'ops-general', groupId: group.id }
        })
        .then(() => cy.wrap({ group }));
    });
}

function seedGroupAdminWorkspace(): Cypress.Chainable<GroupAdminSeed> {
  const adminCredentials = {
    username: 'gina',
    email: 'gina@example.com',
    password: 'GroupAdmin!1'
  };
  const inviteeProfile = {
    username: 'alex',
    email: 'alex@design.test',
    password: 'Design123!'
  };

  return cy
    .request({
      method: 'POST',
      url: `${API_BASE}/users`,
      headers: { 'x-user-id': 'u_super' },
      body: {
        username: adminCredentials.username,
        email: adminCredentials.email,
        password: adminCredentials.password,
        roles: ['group-admin']
      }
    })
    .then(({ body: adminBody }) => {
      expect(adminBody).to.have.property('success', true);
      const admin = adminBody.user as { id: string; username: string };

      return cy
        .request({
          method: 'POST',
          url: `${API_BASE}/users`,
          headers: { 'x-user-id': 'u_super' },
          body: inviteeProfile
        })
        .then(({ body: inviteeBody }) => {
          expect(inviteeBody).to.have.property('success', true);
          const invitee = inviteeBody.user as { id: string; username: string; email: string };

          return cy
            .request({
              method: 'POST',
              url: `${API_BASE}/groups`,
              headers: { 'x-user-id': admin.id },
              body: { name: 'Design' }
            })
            .then(({ body: groupBody }) => {
              expect(groupBody).to.have.property('success', true);
              const group = groupBody.group as { id: string; name: string };

              return cy
                .request({
                  method: 'POST',
                  url: `${API_BASE}/channels`,
                  headers: { 'x-user-id': admin.id },
                  body: { name: 'announcements', groupId: group.id }
                })
                .then(() =>
                  cy.wrap({
                    admin: { id: admin.id, username: admin.username, password: adminCredentials.password },
                    group,
                    invitee: { id: invitee.id, username: invitee.username, email: invitee.email }
                  })
                );
            });
        });
    });
}

describe('Administration Workflows', () => {
  beforeEach(() => {
    cy.task('resetDb');
  });

  it('allows a super admin to create a user and add them to a group', () => {
    seedSuperAdminWorkspace().then(({ group }) => {
    cy.visit(`${APP_BASE}/login`);
    cy.intercept('POST', '**/api/auth/login').as('loginRequest');
    cy.get('input[formcontrolname="username"]').type('super');
    cy.get('input[formcontrolname="password"]').type('123', { log: false });
    cy.get('form.auth-form button.primary-action').click();

    cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
    cy.url({ timeout: 10000 }).should('include', '/dashboard');
      cy.contains('button', 'Super Admin').should('be.visible').click();

      cy.url().should('include', '/admin');
      cy.contains('h1', 'Super Admin Panel').should('be.visible');

      cy.get('.admin-section', { timeout: 10000 })
        .eq(1)
        .find('tbody tr')
        .contains(group.name)
        .closest('tr')
        .as('groupRow');
      cy.get('@groupRow').within(() => {
        cy.get('td').eq(2).invoke('text').then(text => {
          const initialMembers = Number(text.replace(/[^0-9]/g, '')) || 0;
          cy.wrap(initialMembers).as('initialMemberCount');
        });
        cy.root().click();
      });

      cy.intercept('POST', '**/api/users').as('createUser');
      cy.intercept('POST', '**/api/groups/**/members').as('addGroupMember');

      cy.contains('button', '+ New User').click();

      const username = `sam-${Date.now()}`;
      cy.get('.modal-content').within(() => {
        cy.get('input').eq(0).type(username);
        cy.get('input').eq(1).type(`${username}@example.com`);
        cy.get('input').eq(2).type('TempPass123!');
        cy.get('label.checkbox input').should('be.checked');
        cy.contains('button', 'Create User').click();
      });

      cy.wait('@createUser').its('response.statusCode').should('be.oneOf', [200, 201]);
      cy.wait('@addGroupMember').its('response.statusCode').should('eq', 200);

      cy.contains('.toast.success .message', `${username} added to ${group.name}`).should('exist');

      cy.get('.admin-section').eq(0, { timeout: 10000 }).find('tbody tr').contains(username).should('exist');
      cy.get('@initialMemberCount').then(initial => {
        const initialCount = Number(initial);
        cy.get('.admin-section', { timeout: 10000 })
          .eq(1)
          .find('tbody tr')
          .contains(group.name)
          .closest('tr')
          .find('td')
          .eq(2)
          .invoke('text')
          .then(text => {
            const count = Number(text.replace(/[^0-9]/g, '')) || 0;
            expect(count).to.eq(initialCount + 1);
          });
      });
    });
  });

  it('allows a group admin to manage channels and members', () => {
    seedGroupAdminWorkspace().then(({ admin, group, invitee }) => {
    cy.visit(`${APP_BASE}/login`);
    cy.intercept('POST', '**/api/auth/login').as('loginRequest');
    cy.get('input[formcontrolname="username"]').type(admin.username);
    cy.get('input[formcontrolname="password"]').type(admin.password, { log: false });
    cy.get('form.auth-form button.primary-action').click();

    cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
    cy.url({ timeout: 10000 }).should('include', '/dashboard');
      cy.contains('button', 'Group Admin').should('be.visible').click();

      cy.url().should('include', '/group-admin');
      cy.contains('h1', 'Group Administration').should('be.visible');

      cy.contains('.group-card', group.name).click();

      cy.contains('button', '+ Add Channel').click();
      cy.get('.modal-content').within(() => {
        cy.get('input').type('design-sync');
        cy.contains('button', 'Create').click();
      });
      cy.contains('.confirm-card h3', 'Confirm Create').should('be.visible');
      cy.contains('.confirm-card button', 'Confirm').click();
      cy.contains('.toast.success .message', 'Channel created successfully').should('exist');
      cy.contains('.channel-item .channel-name', '# design-sync').should('exist');

      cy.contains('button', '+ Add Member').click();
      cy.contains('.user-option', invitee.username).within(() => {
        cy.contains('button', 'Add').click();
      });
      cy.contains('.confirm-card h3', 'Confirm Add').should('be.visible');
      cy.contains('.confirm-card button', 'Confirm').click();
      cy.contains('.toast.success .message', 'Member added successfully').should('exist');
      cy.contains('.members-list .member-name', invitee.username).should('exist');
    });
  });

  it('allows a group admin to create a group and manage membership lifecycle', () => {
    seedGroupAdminWorkspace().then(({ admin, invitee }) => {
    cy.visit(`${APP_BASE}/login`);
    cy.intercept('POST', '**/api/auth/login').as('loginRequest');
    cy.get('input[formcontrolname="username"]').type(admin.username);
    cy.get('input[formcontrolname="password"]').type(admin.password, { log: false });
    cy.get('form.auth-form button.primary-action').click();

    cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
    cy.url({ timeout: 10000 }).should('include', '/dashboard');
    cy.contains('button', 'Group Admin').should('be.visible').click();

    cy.url().should('include', '/group-admin');
    cy.contains('h1', 'Group Administration').should('be.visible');

    cy.contains('button', '+ New Group').click();
    const groupName = `Product ${Date.now()}`;
    cy.get('.modal-content input').type(groupName);
    cy.contains('.modal-content button', 'Create').click();
    cy.contains('.confirm-card button', 'Confirm').click();
    cy.contains('.toast.success .message', 'Group created successfully').should('exist');

    cy.contains('.group-card', groupName, { timeout: 10000 }).click();

    cy.contains('button', '+ Add Member').click();
    cy.contains('.user-option', invitee.username).within(() => {
      cy.contains('button', 'Add').click();
    });
    cy.contains('.confirm-card button', 'Confirm').click();
    cy.contains('.toast.success .message', 'Member added successfully').should('exist');
    cy.contains('.members-list .member-name', invitee.username).should('exist');

    cy.contains('.member-item', invitee.username).within(() => {
      cy.contains('button', 'Remove').click();
    });
    cy.contains('.confirm-card button', 'Confirm').click();
    cy.contains('.toast.success .message', 'Member removed successfully').should('exist');
    cy.contains('.members-list .member-name', invitee.username).should('not.exist');
    });
  });

  it('allows a super admin to assign roles to other users', () => {
    seedSuperAdminWorkspace().then(({ group }) => {
    cy.request({
      method: 'POST',
      url: `${API_BASE}/users`,
      headers: { 'x-user-id': 'u_super' },
      body: {
        username: 'alexander',
        email: 'alexander@example.com',
        password: 'TempUser!23'
      }
    }).then(({ body: userBody }) => {
      const promoted = userBody.user as { id: string; username: string };

      cy.visit(`${APP_BASE}/login`);
      cy.intercept('POST', '**/api/auth/login').as('loginRequest');
      cy.get('input[formcontrolname="username"]').type('super');
      cy.get('input[formcontrolname="password"]').type('123', { log: false });
      cy.get('form.auth-form button.primary-action').click();

      cy.wait('@loginRequest', { timeout: 10000 }).its('response.statusCode').should('eq', 200);
      cy.url({ timeout: 10000 }).should('include', '/dashboard');
      cy.contains('button', 'Super Admin').click();

      cy.url().should('include', '/admin');
      cy.contains('h1', 'Super Admin Panel').should('be.visible');

      cy.contains('.admin-section', 'Group Management').find('tbody tr').contains(group.name);

      cy.contains('.admin-section', 'User Management')
        .find('tbody tr')
        .contains(promoted.username)
        .closest('tr')
        .as('promoteRow');

      cy.intercept('POST', '**/api/users/**/promote').as('promoteUser');

      cy.get('@promoteRow').find('button').contains('Promote to Group Admin').click();
      cy.contains('.confirm-card button', 'Confirm').click();

      cy.wait('@promoteUser').its('response.statusCode').should('eq', 200);
      cy.contains('.toast.success .message', 'User promoted to Group Admin').should('exist');

      cy.contains('.admin-section', 'User Management')
        .find('tbody tr')
        .contains(promoted.username)
        .closest('tr')
        .should('contain.text', 'group-admin')
        .within(() => {
          cy.contains('Promote to Group Admin').should('not.exist');
        });
    });
    });
  });
});
