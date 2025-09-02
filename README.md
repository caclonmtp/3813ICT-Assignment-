# MEAN Chat – Developer README

_Last updated: 2025-09-02 15:15 _

This document explains how data is persisted, the main data structures, the REST API provided by the Node/Express server, and the Angular front‑end architecture.

> Codebase detected from the provided archive:
>
> - **Server**: `mean-chat/server` (Express + in‑memory storage layer at `server/data/storage.js`)
> - **Client**: `mean-chat/client/chat` (Angular application)

---

## 1) Data persistence (JSON on disk)

### Intended behaviour

The storage layer converts in‑memory objects to JSON and saves them to a text file **after each mutation** (create, update, delete). When the server starts, it **loads** the JSON file back into memory.

**Recommended file**: `server/data/db.json`

**Recommended approach (in `server/data/storage.js`)**:
- On start: read `db.json` if present, otherwise seed with defaults.
- On every write (add/update/delete): write the `storage` object to `db.json`.

> Note: In the provided code, `storage.js` contains placeholders (`...`) indicating where file I/O helpers should be implemented. The following pattern is what the stubs are designed for:

```js
// server/data/storage.js (illustrative pattern)
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'db.json');

let storage = {{ users: [], groups: [], channels: [], messages: [] }};

function load() {{
  if (fs.existsSync(DB_PATH)) {{
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    storage = JSON.parse(raw || '{{}}');
  }} else {{
    // seed default super-admin, etc., then save();
  }}
}

function save() {{
  fs.writeFileSync(DB_PATH, JSON.stringify(storage, null, 2), 'utf8');
}

// Example mutation
function addUser(user) {{
  storage.users.push(user);
  save(); // persist after every change
  return user;
}}
```

### What’s currently in the code

- `server/data/storage.js` defines the in‑memory `storage` object with collections: `users`, `groups`, `channels`, `messages`, and contains methods with **placeholders (`...`)** where the JSON **load/save** should be wired in.
- If you need the README to strictly reflect the code as‑is: **on‑disk JSON persistence is not fully wired up yet**. Implement the `load()` on server start and call `save()` in each mutation method to meet the requirement.

---

## 2) Main data structures

Types inferred from the Angular models and server usage.

### User
File: `client/chat/src/app/models/user.model.ts`
```ts
export interface User {{
  id: string;
  username: string;
  email: string;
  roles: string[];   // e.g., ['user'], ['group-admin'], ['super-admin']
  groups: string[];  // array of group ids the user belongs to
}}
```

### Group
File: `client/chat/src/app/models/group.model.ts`
```ts
export interface Group {{
  id: string;
  name: string;
  createdBy: string; // user id
  admins: string[];  // user ids
  members: string[]; // user ids
  createdAt: Date;
}}
```

### Channel
File: `client/chat/src/app/models/channel.model.ts`
```ts
export interface Channel {{
  id: string;
  name: string;
  groupId: string;   // parent group id
  createdBy: string; // user id
  createdAt: Date;
}}
```

### Message
Inferred from `ChatComponent`:
```ts
interface Message {{
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: Date;
  channelId: string;
}}
```

> Server-side, these are kept under `storage.users`, `storage.groups`, `storage.channels`, `storage.messages` and (once persistence is wired) serialized to JSON.

---

## 3) REST API (Express)

**Base URL**: `http://localhost:3000/api`

Mounted in `server/server.js`:
- `/api/auth` → `routes/auth.js`
- `/api/users` → `routes/users.js`
- `/api/groups` → `routes/groups.js`
- `/api/channels` → `routes/channels.js`

> Several route files contain placeholder blocks (`...`). The table below documents the routes that are present and/or implied by the code.

### Auth (`/api/auth`)
| Method | Path        | Body                                    | Returns                               | Notes |
|-------:|-------------|-----------------------------------------|---------------------------------------|------|
| POST   | `/login`    | `{{ username, password }}`               | `{{ success, user }}` (no password)   | Looks up user from `storage.getUsers()`. 401 on invalid credentials. |
| POST   | `/register` | `{{ username, email, password }}`        | `{{ success, user }}` (no password)   | Creates user with roles `['user']`. Persists via `storage.addUser()`. *(Code stub shows creation block; route file contains a placeholder before it.)* |

### Users (`/api/users`)
| Method | Path                  | Body / Params                            | Returns                        | Notes |
|-------:|-----------------------|------------------------------------------|--------------------------------|------|
| GET    | `/`                   | –                                        | `User[]` (without passwords)   | Maps over users to strip `password`. |
| GET    | `/:id`               | `id`                                     | `User` (without password)      | Contains a placeholder before the return in the file. |
| PUT    | `/:id`               | Partial `User` fields                    | `User` (updated, no password)  | **Implied** by `user.service.updateUser`. |
| DELETE | `/:id`               | `id`                                     | `{{ message }}`                | **Implied** by `user.service.deleteUser`. |
| POST   | `/:id/promote`       | –                                        | `User` (with updated roles)    | Promotes to `group-admin` if not present. |

### Groups (`/api/groups`)
| Method | Path                        | Body / Params                              | Returns          | Notes |
|-------:|-----------------------------|--------------------------------------------|------------------|------|
| GET    | `/`                         | –                                          | `Group[]`        | Returns all groups. |
| GET    | `/user/:userId`            | `userId`                                   | `Group[]`        | Filters by membership or user being super-admin. Contains placeholders mid‑file. |
| POST   | `/`                         | `{{ name, createdBy }}`                    | `Group`          | **Implied** by `group.service.createGroup`. |
| POST   | `/:groupId/members`        | `{{ userId }}`                             | `Group`          | Add user to group. |
| DELETE | `/:groupId/members/:userId`| `groupId`, `userId`                        | `Group`          | Remove user from group. |
| DELETE | `/:id`                     | `id`                                       | `{{ message }}`  | Deletes group AND removes group id from members. Code shows this cleanup. |

### Channels (`/api/channels`)
| Method | Path                 | Body / Params                     | Returns   | Notes |
|-------:|----------------------|-----------------------------------|-----------|------|
| GET    | `/group/:groupId`    | `groupId`                         | `Channel[]` | Channels for a group. |
| POST   | `/`                  | `{{ name, groupId, createdBy }}`  | `Channel` | Creates channel. File contains placeholder before response. |
| DELETE | `/:id`               | `id`                              | `{{ message }}` | Deletes channel. |

> If you introduce message endpoints later, keep them under `/api/messages` with `channelId` filters.

---

## 4) Angular architecture

Root path: `client/chat/src/app`

### Modules & Routing
- `AppModule` declares components and imports `HttpClientModule`, `FormsModule`, `ReactiveFormsModule`.
- `AppRoutingModule` defines routes:
  - `/login` → `LoginComponent`
  - `/dashboard` → `DashboardComponent` (guarded)
  - `/chat/:channelId` → `ChatComponent` (guarded)
  - `/admin` → `AdminComponent` (guarded, role: `super-admin`)
  - `/group-admin` → `GroupAdminComponent` (guarded, roles: `group-admin` or `super-admin`)
- `AuthGuard` checks authentication and optional `data.roles` authorization.

### Components
- **LoginComponent**: Handles login/registration forms. On success, navigates to `/dashboard`.
- **DashboardComponent**: Shows current user, their groups/channels, allows logout. (Uses `GroupService` and `AuthService`; also fetches channels via `HttpClient`).
- **ChatComponent**: Renders messages for a channel (`:channelId` route param), sends new messages to the server (uses `HttpClient`).
- **AdminComponent** *(super-admin)*: Manages users and groups: promote users, add/remove users to/from groups.
- **GroupAdminComponent** *(group-admin)*: Manages groups they created/administer: create/delete groups, manage channels and membership.

### Services
- **AuthService**
  - Holds a `BehaviorSubject<User | null>` for the current user.
  - Persists current user to `localStorage` via `StorageService`.
  - Methods: `login`, `register`, `logout`, `isSuperAdmin()`, `isGroupAdmin()`. *(File shows placeholders where HTTP calls to `/api/auth` should be.)*
- **UserService**
  - Base URL: `/api/users`.
  - Methods: `getUsers()`, `getUser(id)`, `updateUser(id, updates)`, `deleteUser(id)`, `promoteToGroupAdmin(id)`.
- **GroupService**
  - Base URL: `/api/groups`.
  - Methods: `getGroups()`, `getGroupsForUser(userId)`, `createGroup(name, createdBy)`, `addUserToGroup(groupId, userId)`, `removeUserFromGroup(groupId, userId)`, `deleteGroup(id)`.
- **StorageService**
  - Thin wrapper around `localStorage` (`setItem`, `getItem`, `removeItem`, `clear`).

### Models
See §2. Models live under `src/app/models`.

---

## 5) Running the project

### Server
```bash
cd mean-chat/server
npm install
node server.js
# Server will listen on http://localhost:3000
```

### Client (Angular)
```bash
cd mean-chat/client/chat
npm install
npm start
# or: ng serve --open
# Client at http://localhost:4200
```

> If CORS is needed, the server already enables it (`cors()` middleware).

---

## 6) Known gaps / to‑dos (as of the provided archive)

- Files under `server/routes/*.js` and `server/data/storage.js` contain **placeholder sections (`...`)**.
  - Wire up **JSON persistence**: implement `load()` on server start and call `save()` in each mutation (`addUser`, `updateUser`, `deleteUser`, `addGroup`, `updateGroup`, `deleteGroup`, `addChannel`, `deleteChannel`, etc.).
  - Complete missing route bodies where `...` appears.
- Ensure all Angular services align with the server endpoints (URLs and payload shapes).
- Add message endpoints (`/api/messages`) if real‑time chat/history is required, or swap to WebSockets later.

---

## 7) Example JSON shapes

**User**
```json
{{
  "id": "u_1714543999000",
  "username": "alice",
  "email": "alice@example.com",
  "roles": ["user"],
  "groups": ["g_1", "g_2"]
}}
```

**Group**
```json
{{
  "id": "g_1",
  "name": "Frontend Team",
  "createdBy": "u_1714543999000",
  "admins": ["u_1714543999000"],
  "members": ["u_1714543999000", "u_1714543999555"],
  "createdAt": "2025-09-03T00:00:00.000Z"
}}
```

**Channel**
```json
{{
  "id": "c_1",
  "name": "general",
  "groupId": "g_1",
  "createdBy": "u_1714543999000",
  "createdAt": "2025-09-03T00:00:00.000Z"
}}
```

**Message**
```json
{{
  "id": "m_1",
  "userId": "u_1714543999000",
  "username": "alice",
  "content": "Hello team!",
  "timestamp": "2025-09-03T01:23:45.000Z",
  "channelId": "c_1"
}}
```

---

## 8) Security notes

- Passwords are stored in plaintext in the current stub. For any non‑demo use, use proper hashing (e.g., bcrypt) and never return password fields to the client.
- Consider authorization checks on each protected route, not only on the client guard.

---

## 9) License & authorship

Course assignment scaffold for an Angular + Node/Express (MEAN‑style) chat/admin exercise.
